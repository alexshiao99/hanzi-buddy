import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { clipboard, systemPreferences } from 'electron';
import { hasHan } from './lookup';

const MAX_LEN = 300;
/** Markers password managers and similar apps put on the clipboard (see nspasteboard.org). */
const PRIVATE_FORMATS = ['org.nspasteboard.ConcealedType', 'org.nspasteboard.TransientType'];

const isLookupCandidate = (text: string) => text.length > 0 && text.length <= MAX_LEN && hasHan(text);

async function isPrivateClipboard(): Promise<boolean> {
  const found = await Promise.all(
    PRIVATE_FORMATS.map((format) => clipboard.has(`electron application/osclipboard;format="${format}"`)),
  );
  return found.includes(true);
}

/** Polls the clipboard and reports newly copied text that contains Chinese characters. */
export class ClipboardWatcher {
  /** null until the next poll records what's there, so existing clipboard contents never fire. */
  private last: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private paused = false;
  private polling = false;

  constructor(private readonly onText: (text: string) => void) {}

  start(): void {
    if (this.timer) return;
    this.last = null;
    this.timer = setInterval(() => void this.tick(), 500);
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
    if (!paused) this.last = null;
  }

  private async tick(): Promise<void> {
    if (this.paused || this.polling) return;
    this.polling = true;
    try {
      const text = await clipboard.readText();
      if (this.paused || text === this.last) return; // paused during the read: the result may be stale
      const isFirstRead = this.last === null;
      this.last = text;
      if (isFirstRead) return;
      const trimmed = text.trim();
      if (isLookupCandidate(trimmed) && !(await isPrivateClipboard())) this.onText(trimmed);
    } catch {
      // a failed read is retried on the next poll
    } finally {
      this.polling = false;
    }
  }
}

export function hasAccessibility(prompt: boolean): boolean {
  return systemPreferences.isTrustedAccessibilityClient(prompt);
}

export type GrabResult =
  | { status: 'text'; text: string }
  | { status: 'none' | 'too-long' | 'helper-missing' };

function runHelper(binPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(binPath, { timeout: 5000, maxBuffer: 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

/** Copies the selection in the frontmost app through the native helper, which restores the clipboard. */
export async function grabSelection(binPath: string, watcher: ClipboardWatcher): Promise<GrabResult> {
  if (!existsSync(binPath)) return { status: 'helper-missing' };
  watcher.setPaused(true);
  try {
    const text = (await runHelper(binPath)).trim();
    if (!hasHan(text)) return { status: 'none' };
    return isLookupCandidate(text) ? { status: 'text', text } : { status: 'too-long' };
  } finally {
    watcher.setPaused(false);
  }
}
