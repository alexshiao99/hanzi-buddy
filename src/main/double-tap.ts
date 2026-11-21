import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';

export type TapModifier = 'option' | 'control' | 'command' | 'shift';

/** Two taps closer together than this count as a double tap (macOS uses about the same for ⌥⌥). */
export const DOUBLE_TAP_MS = 400;

/** Turns the helper's "tap" / "cancel" lines into double taps. Pure, so it can be tested. */
export class DoubleTapDetector {
  private lastTap: number | null = null;

  /** Returns true when this line completes a double tap. */
  feed(line: string, now: number): boolean {
    if (line === 'cancel') {
      this.lastTap = null;
      return false;
    }
    if (line !== 'tap') return false;
    if (this.lastTap !== null && now - this.lastTap <= DOUBLE_TAP_MS) {
      this.lastTap = null; // a third tap starts over rather than firing again
      return true;
    }
    this.lastTap = now;
    return false;
  }
}

const PERMISSION_EXIT = 2;
const PERMISSION_RETRY_MS = 5000;
const RESTART_DELAY_MS = 2000;
const MAX_RESTARTS = 3;

/**
 * Runs the native modifier-tap helper and calls `onDoubleTap` when the modifier is tapped twice.
 * Without the Accessibility permission the helper can't start; it is retried every few seconds
 * so the shortcut starts working as soon as the permission is granted.
 */
export class DoubleTapWatcher {
  private proc: ChildProcess | null = null;
  private timer: NodeJS.Timeout | undefined;
  private restarts = 0;
  private modifier: TapModifier | null = null;
  /** False while macOS is refusing the event tap. */
  permitted = true;

  constructor(
    private readonly binPath: string,
    private readonly onDoubleTap: () => void,
    private readonly now: () => number = Date.now,
  ) {}

  get available(): boolean {
    return existsSync(this.binPath);
  }

  start(modifier: TapModifier): void {
    if (this.proc && this.modifier === modifier) return;
    this.stop();
    this.modifier = modifier;
    this.spawn();
  }

  stop(): void {
    clearTimeout(this.timer);
    this.modifier = null;
    this.restarts = 0;
    const proc = this.proc;
    this.proc = null;
    proc?.kill();
  }

  private spawn(): void {
    const modifier = this.modifier;
    if (!modifier || !this.available) return;
    const detector = new DoubleTapDetector();
    const proc = spawn(this.binPath, [modifier], { stdio: ['pipe', 'pipe', 'ignore'] });
    this.proc = proc;
    createInterface({ input: proc.stdout! }).on('line', (line) => {
      if (this.proc !== proc) return;
      this.permitted = true;
      if (detector.feed(line.trim(), this.now())) this.onDoubleTap();
    });

    // A failed spawn emits only 'error'; a crash emits only 'exit'. Either way, handle it once.
    let gone = false;
    const onGone = (code: number | null) => {
      if (gone || this.proc !== proc) return; // stopped on purpose or replaced
      gone = true;
      this.proc = null;
      if (code === PERMISSION_EXIT) {
        this.permitted = false;
        this.timer = setTimeout(() => this.spawn(), PERMISSION_RETRY_MS);
      } else if (this.restarts < MAX_RESTARTS) {
        this.restarts++;
        this.timer = setTimeout(() => this.spawn(), RESTART_DELAY_MS);
      }
    };
    proc.on('error', () => onGone(null));
    proc.on('exit', (code) => onGone(code));
  }
}
