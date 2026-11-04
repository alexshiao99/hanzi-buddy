import { execFile } from 'node:child_process';
import { clipboard, systemPreferences } from 'electron';
import { hasHan } from './lookup';

const MAX_LEN = 300;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const isLookupCandidate = (text: string) => text.trim().length > 0 && text.length <= MAX_LEN && hasHan(text);

/** Polls the clipboard and reports newly copied text that contains Chinese characters. */
export class ClipboardWatcher {
  private last = clipboard.readText();
  private timer: NodeJS.Timeout | null = null;
  private paused = false;

  constructor(private readonly onText: (text: string) => void) {}

  start(): void {
    if (this.timer) return;
    this.last = clipboard.readText(); // don't fire for whatever was already on the clipboard
    this.timer = setInterval(() => this.tick(), 500);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Treat `text` as already seen (used when the app itself writes to the clipboard). */
  markSeen(text: string): void {
    this.last = text;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    if (!paused) this.last = clipboard.readText();
  }

  private tick(): void {
    if (this.paused) return;
    const text = clipboard.readText();
    if (text === this.last) return;
    this.last = text;
    if (isLookupCandidate(text)) this.onText(text.trim());
  }
}

export function hasAccessibility(prompt: boolean): boolean {
  return systemPreferences.isTrustedAccessibilityClient(prompt);
}

function pressCopy(): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      'osascript',
      ['-e', 'tell application "System Events" to keystroke "c" using {command down}'],
      (err) => (err ? reject(err) : resolve()),
    );
  });
}

/**
 * Copies the current selection in the frontmost app by sending Cmd+C, reads it, then restores the
 * previous clipboard text. Returns null if nothing Chinese was selected.
 */
export async function grabSelection(watcher: ClipboardWatcher): Promise<string | null> {
  watcher.setPaused(true);
  const previous = clipboard.readText();
  try {
    // Give the user a moment to release the hotkey's modifiers so they don't turn Cmd+C into Cmd+Shift+C.
    await sleep(180);
    clipboard.clear();
    await pressCopy();
    let text = '';
    for (let i = 0; i < 10 && !text; i++) {
      await sleep(40);
      text = clipboard.readText();
    }
    return isLookupCandidate(text) ? text.trim() : null;
  } finally {
    if (previous) clipboard.writeText(previous);
    watcher.markSeen(previous);
    watcher.setPaused(false);
  }
}
