// Watches the text highlighted in the frontmost app via the macOS Accessibility API.
// Prints one JSON string per line whenever the selection changes. Only selections the app can look
// up are reported: text containing Chinese characters, or English (Latin letters, no "://" links).
// Anything else (and password fields) is reported as "" so the parent process never sees unrelated
// text. The app decides which mode to open from the text itself. Exits when stdin closes (i.e. the
// parent app quit).
//
// Build: clang -O2 -framework ApplicationServices native/selection-watcher.c -o bin/selection-watcher
#include <ApplicationServices/ApplicationServices.h>
#include <libproc.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define MAX_CHARS 300
#define POLL_USEC 300000

static int debug = 0;

static CFTypeRef copy_attr(AXUIElementRef el, CFStringRef name) {
  CFTypeRef value = NULL;
  AXError err = AXUIElementCopyAttributeValue(el, name, &value);
  if (err != kAXErrorSuccess) {
    if (debug) {
      char n[64] = "";
      CFStringGetCString(name, n, sizeof n, kCFStringEncodingUTF8);
      fprintf(stderr, "AX error %d reading %s\n", err, n);
    }
    return NULL;
  }
  return value;
}

static int has_han(CFStringRef s) {
  CFIndex n = CFStringGetLength(s);
  for (CFIndex i = 0; i < n; i++) {
    UniChar c = CFStringGetCharacterAtIndex(s, i);
    if ((c >= 0x3400 && c <= 0x4DBF) || (c >= 0x4E00 && c <= 0x9FFF) || (c >= 0xF900 && c <= 0xFAFF)) return 1;
    if (c >= 0xD840 && c <= 0xD87F) return 1; // high surrogates for CJK extension planes (U+20000–U+2FFFF)
  }
  return 0;
}

static int has_latin(CFStringRef s) {
  CFIndex n = CFStringGetLength(s);
  for (CFIndex i = 0; i < n; i++) {
    UniChar c = CFStringGetCharacterAtIndex(s, i);
    if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')) return 1;
  }
  return 0;
}

/** Chinese, or English that isn't a link. */
static int wanted(CFStringRef s) {
  if (has_han(s)) return 1;
  return has_latin(s) && CFStringFind(s, CFSTR("://"), 0).location == kCFNotFound;
}

/** PID of the app owning the frontmost normal window (layer 0), or -1. */
static pid_t frontmost_pid(void) {
  pid_t pid = -1;
  CFArrayRef windows = CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, kCGNullWindowID);
  if (!windows) return -1;
  for (CFIndex i = 0; i < CFArrayGetCount(windows); i++) {
    CFDictionaryRef w = CFArrayGetValueAtIndex(windows, i);
    int layer = -1;
    CFNumberRef layerRef = CFDictionaryGetValue(w, kCGWindowLayer);
    CFNumberRef pidRef = CFDictionaryGetValue(w, kCGWindowOwnerPID);
    if (!layerRef || !pidRef || !CFNumberGetValue(layerRef, kCFNumberIntType, &layer) || layer != 0) continue;
    CFNumberGetValue(pidRef, kCFNumberIntType, &pid);
    break;
  }
  CFRelease(windows);
  return pid;
}

/** True for Chrome, Edge, Brave, Arc, Vivaldi, Opera, Chromium (by executable path). */
static int is_chromium_browser(pid_t pid) {
  char path[PROC_PIDPATHINFO_MAXSIZE];
  if (proc_pidpath(pid, path, sizeof path) <= 0) return 0;
  const char *names[] = {"Google Chrome", "Microsoft Edge", "Brave Browser", "Arc.app", "Vivaldi", "Opera", "Chromium"};
  for (size_t i = 0; i < sizeof names / sizeof *names; i++)
    if (strstr(path, names[i])) return 1;
  return 0;
}

/**
 * Chromium-based apps (Chrome, Edge, Brave, Electron apps) only build their accessibility tree when
 * asked. Setting AXManualAccessibility turns it on so their selected text becomes readable. Done once
 * per process; apps that don't know the attribute just ignore it.
 */
static void enable_web_accessibility(AXUIElementRef appEl, pid_t pid) {
  enum { SLOTS = 64 };
  static pid_t done[SLOTS]; // ring buffer of PIDs already handled
  static int next = 0, filled = 0;
  for (int i = 0; i < filled; i++)
    if (done[i] == pid) return;
  AXError err = AXUIElementSetAttributeValue(appEl, CFSTR("AXManualAccessibility"), kCFBooleanTrue);
  if (debug) fprintf(stderr, "AXManualAccessibility on pid %d -> %d\n", pid, err);
  if (err == kAXErrorAttributeUnsupported && is_chromium_browser(pid)) {
    // Chrome-family browsers only accept the VoiceOver-style flag.
    err = AXUIElementSetAttributeValue(appEl, CFSTR("AXEnhancedUserInterface"), kCFBooleanTrue);
    if (debug) fprintf(stderr, "AXEnhancedUserInterface on pid %d -> %d\n", pid, err);
  }
  done[next] = pid;
  next = (next + 1) % SLOTS;
  if (filled < SLOTS) filled++;
}

/** Returns a new string with the current Chinese or English selection, or NULL. */
static CFStringRef current_selection(void) {
  CFStringRef result = NULL;
  // Ask the frontmost app (more reliable than the system-wide element) for its focused element.
  pid_t pid = frontmost_pid();
  if (debug) fprintf(stderr, "frontmost pid %d\n", pid);
  if (pid <= 0) return NULL;
  AXUIElementRef appEl = AXUIElementCreateApplication(pid);
  enable_web_accessibility(appEl, pid);
  CFTypeRef focused = copy_attr(appEl, kAXFocusedUIElementAttribute);
  CFRelease(appEl);
  if (!focused) return NULL;
  if (CFGetTypeID(focused) != AXUIElementGetTypeID()) goto done;

  CFTypeRef subrole = copy_attr((AXUIElementRef)focused, kAXSubroleAttribute);
  int secure = subrole && CFGetTypeID(subrole) == CFStringGetTypeID() &&
               CFStringCompare((CFStringRef)subrole, kAXSecureTextFieldSubrole, 0) == kCFCompareEqualTo;
  if (subrole) CFRelease(subrole);
  if (secure) goto done;

  CFTypeRef text = copy_attr((AXUIElementRef)focused, kAXSelectedTextAttribute);
  if (!text) goto done;
  if (CFGetTypeID(text) == CFStringGetTypeID()) {
    CFMutableStringRef trimmed = CFStringCreateMutableCopy(NULL, 0, (CFStringRef)text);
    CFStringTrimWhitespace(trimmed);
    CFIndex len = CFStringGetLength(trimmed);
    if (len > 0 && len <= MAX_CHARS && wanted(trimmed)) result = trimmed;
    else CFRelease(trimmed);
  }
  CFRelease(text);
done:
  CFRelease(focused);
  return result;
}

static void emit(CFStringRef s) {
  char buf[MAX_CHARS * 4 + 1] = "";
  if (s) CFStringGetCString(s, buf, sizeof buf, kCFStringEncodingUTF8);
  putchar('"');
  for (unsigned char *p = (unsigned char *)buf; *p; p++) {
    if (*p == '"' || *p == '\\') printf("\\%c", *p);
    else if (*p == '\n') fputs("\\n", stdout);
    else if (*p == '\r') fputs("\\r", stdout);
    else if (*p == '\t') fputs("\\t", stdout);
    else if (*p < 0x20) printf("\\u%04x", *p);
    else putchar(*p);
  }
  fputs("\"\n", stdout);
  fflush(stdout);
}

static void *watch_stdin(void *arg) {
  (void)arg;
  while (getchar() != EOF) {}
  exit(0);
}

int main(void) {
  pthread_t t;
  debug = getenv("SELECTION_WATCHER_DEBUG") != NULL;
  pthread_create(&t, NULL, watch_stdin, NULL);
  if (!AXIsProcessTrusted()) fputs("accessibility permission missing\n", stderr);

  CFStringRef last = NULL;
  for (;;) {
    CFStringRef cur = current_selection();
    int changed = (cur == NULL) != (last == NULL) || (cur && CFStringCompare(cur, last, 0) != kCFCompareEqualTo);
    if (changed) emit(cur);
    if (last) CFRelease(last);
    last = cur;
    usleep(POLL_USEC);
  }
}
