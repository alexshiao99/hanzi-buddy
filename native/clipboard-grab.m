// Copies the selection in the frontmost app and prints it as UTF-8, leaving the clipboard as it was.
// Every item and format on the clipboard (images, files, rich text...) is snapshotted first and put
// back afterwards. If the app copies nothing, the clipboard is never touched. Exits 0 either way;
// empty output means nothing was copied. Requires the Accessibility permission.
//
// Build: clang -O2 -fobjc-arc -framework AppKit -framework ApplicationServices native/clipboard-grab.m -o bin/clipboard-grab
#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#include <stdio.h>
#include <unistd.h>

#define KEY_C 8 // kVK_ANSI_C
#define MAX_CHARS 4096 // well past the app's lookup limit, so it can still tell "too long" from "nothing"
#define TIMEOUT_USEC 600000
#define POLL_USEC 20000

static NSArray<NSPasteboardItem *> *snapshot(NSPasteboard *pb) {
  NSMutableArray<NSPasteboardItem *> *items = [NSMutableArray array];
  for (NSPasteboardItem *item in pb.pasteboardItems) {
    NSPasteboardItem *copy = [NSPasteboardItem new];
    for (NSPasteboardType type in item.types) {
      NSData *data = [item dataForType:type];
      if (data) [copy setData:data forType:type];
    }
    [items addObject:copy];
  }
  return items;
}

/**
 * The event carries exactly the Command flag and a private source, so modifiers still held from the
 * hotkey can't turn it into Cmd+Shift+C.
 */
static void press_copy(void) {
  CGEventSourceRef source = CGEventSourceCreate(kCGEventSourceStatePrivate);
  for (int down = 1; down >= 0; down--) {
    CGEventRef event = CGEventCreateKeyboardEvent(source, KEY_C, down);
    CGEventSetFlags(event, kCGEventFlagMaskCommand);
    CGEventPost(kCGHIDEventTap, event);
    CFRelease(event);
  }
  if (source) CFRelease(source);
}

/** Returns the text `copy` put on `pb`, or nil if nothing arrived, with `pb` restored. */
static NSString *grab(NSPasteboard *pb, void (*copy)(void)) {
  NSArray<NSPasteboardItem *> *saved = snapshot(pb);
  NSInteger before = pb.changeCount;
  copy();
  for (useconds_t waited = 0; pb.changeCount == before && waited < TIMEOUT_USEC; waited += POLL_USEC) usleep(POLL_USEC);
  if (pb.changeCount == before) return nil;

  usleep(POLL_USEC); // apps can add formats in several steps; let them finish before restoring
  NSString *text = [pb stringForType:NSPasteboardTypeString];
  [pb clearContents];
  if (saved.count > 0) [pb writeObjects:saved];
  return text;
}

int main(void) {
  @autoreleasepool {
    NSString *text = grab(NSPasteboard.generalPasteboard, press_copy);
    if (text.length > MAX_CHARS) {
      // Cut on a character boundary so the output stays valid UTF-8.
      text = [text substringToIndex:[text rangeOfComposedCharacterSequenceAtIndex:MAX_CHARS].location];
    }
    if (text.length > 0) fputs(text.UTF8String, stdout);
  }
  return 0;
}
