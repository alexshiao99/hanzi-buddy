// Reports quick taps of one modifier key (Option unless another is named) so the app can react to a double tap.
//
// Prints "tap" when the modifier is pressed and released on its own within TAP_MAX_MS, and "cancel"
// when anything else happens shortly after a tap (another key, another modifier, a click), so
// "⌥, a, ⌥" doesn't count as a double tap. Which other key was pressed is never reported, and
// nothing is printed while you type normally. The parent decides what counts as a double tap.
//
// Exits with status 2 if macOS won't allow the event tap (Accessibility permission missing), and
// exits when stdin closes (i.e. the parent app quit).
//
// Usage: modifier-tap [option|control|command|shift]   (MODIFIER_TAP_DEBUG=1 logs events to stderr)
// Build: clang -O2 -framework ApplicationServices native/modifier-tap.c -o bin/modifier-tap
#include <ApplicationServices/ApplicationServices.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define TAP_MAX_MS 350
#define CANCEL_WINDOW_MS 600

static const CGEventFlags MODIFIERS = kCGEventFlagMaskAlternate | kCGEventFlagMaskControl | kCGEventFlagMaskCommand |
                                      kCGEventFlagMaskShift | kCGEventFlagMaskSecondaryFn;

static CGEventFlags target = kCGEventFlagMaskAlternate;
static CFMachPortRef tap_port = NULL;
static int armed = 0;        // the target modifier is down on its own
static double down_at = 0;   // ms
static double last_tap = -1e9;

static double now_ms(void) { return CFAbsoluteTimeGetCurrent() * 1000.0; }

static void emit(const char *line) {
  printf("%s\n", line);
  fflush(stdout);
}

/** Something other than a clean tap happened: forget the press, and tell the parent if a tap was recent. */
static void interrupt(void) {
  armed = 0;
  if (now_ms() - last_tap < CANCEL_WINDOW_MS) {
    last_tap = -1e9;
    emit("cancel");
  }
}

static CGEventRef on_event(CGEventTapProxy proxy, CGEventType type, CGEventRef event, void *info) {
  (void)proxy;
  (void)info;
  if (type == kCGEventTapDisabledByTimeout || type == kCGEventTapDisabledByUserInput) {
    if (tap_port) CGEventTapEnable(tap_port, true);
    return event;
  }
  if (getenv("MODIFIER_TAP_DEBUG")) fprintf(stderr, "event type=%d flags=%llx\n", type, (unsigned long long)CGEventGetFlags(event));
  if (type != kCGEventFlagsChanged) {
    interrupt(); // a key or click
    return event;
  }
  CGEventFlags mods = CGEventGetFlags(event) & MODIFIERS;
  if (mods == target) {
    // The target went down with no other modifier held.
    armed = 1;
    down_at = now_ms();
  } else if (mods == 0 && armed) {
    armed = 0;
    if (now_ms() - down_at <= TAP_MAX_MS) {
      last_tap = now_ms();
      emit("tap");
    }
  } else {
    interrupt(); // another modifier joined in, e.g. ⌥⌘
  }
  return event;
}

static void *watch_stdin(void *arg) {
  (void)arg;
  char buf[64];
  while (read(STDIN_FILENO, buf, sizeof buf) > 0) {
  }
  exit(0);
}

int main(int argc, char **argv) {
  if (argc > 1) {
    if (strcmp(argv[1], "control") == 0) target = kCGEventFlagMaskControl;
    else if (strcmp(argv[1], "command") == 0) target = kCGEventFlagMaskCommand;
    else if (strcmp(argv[1], "shift") == 0) target = kCGEventFlagMaskShift;
    else if (strcmp(argv[1], "option") != 0) {
      fprintf(stderr, "usage: modifier-tap [option|control|command|shift]\n");
      return 64;
    }
  }

  CGEventMask mask = CGEventMaskBit(kCGEventFlagsChanged) | CGEventMaskBit(kCGEventKeyDown) |
                     CGEventMaskBit(kCGEventLeftMouseDown) | CGEventMaskBit(kCGEventRightMouseDown) |
                     CGEventMaskBit(kCGEventOtherMouseDown);
  // Listen-only: events pass through untouched.
  tap_port = CGEventTapCreate(kCGSessionEventTap, kCGHeadInsertEventTap, kCGEventTapOptionListenOnly, mask, on_event, NULL);
  if (!tap_port) {
    fprintf(stderr, "modifier-tap: event tap not allowed (grant Accessibility permission)\n");
    return 2;
  }

  pthread_t t;
  pthread_create(&t, NULL, watch_stdin, NULL);

  CFRunLoopSourceRef source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap_port, 0);
  CFRunLoopAddSource(CFRunLoopGetCurrent(), source, kCFRunLoopCommonModes);
  CGEventTapEnable(tap_port, true);
  CFRunLoopRun();
  return 0;
}
