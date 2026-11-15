import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';

const RESTART_DELAY_MS = 2000;
const MAX_RESTARTS = 3;
/** A helper that ran this long was healthy, so a later crash starts a fresh restart budget. */
const HEALTHY_AFTER_MS = 30_000;

/**
 * Runs the native selection-watcher helper, which reports text highlighted in the frontmost app
 * (only when it contains Chinese). Requires the Accessibility permission.
 */
export class SelectionWatcher {
  private proc: ChildProcess | null = null;
  private restarts = 0;
  private restartTimer: NodeJS.Timeout | undefined;
  /** The currently highlighted Chinese text, or "" when nothing relevant is selected. */
  current = '';

  constructor(
    private readonly binPath: string,
    private readonly onChange: (text: string) => void,
  ) {}

  get available(): boolean {
    return existsSync(this.binPath);
  }

  start(): void {
    if (this.proc || !this.available) return;
    clearTimeout(this.restartTimer);
    const startedAt = Date.now();
    const proc = spawn(this.binPath, [], { stdio: ['pipe', 'pipe', 'ignore'] });
    this.proc = proc;
    createInterface({ input: proc.stdout! }).on('line', (line) => {
      if (this.proc !== proc) return;
      try {
        const text = JSON.parse(line) as unknown;
        if (typeof text === 'string') this.setCurrent(text);
      } catch {
        // ignore malformed lines
      }
    });

    // A failed spawn emits only 'error'; a crash emits only 'exit'. Either way, handle it once.
    const onGone = () => {
      if (this.proc !== proc) return; // stopped on purpose, or already replaced by a newer helper
      this.proc = null;
      this.setCurrent('');
      if (Date.now() - startedAt >= HEALTHY_AFTER_MS) this.restarts = 0;
      if (this.restarts < MAX_RESTARTS) {
        this.restarts++;
        this.restartTimer = setTimeout(() => this.start(), RESTART_DELAY_MS);
      }
    };
    proc.on('error', onGone);
    proc.on('exit', onGone);
  }

  stop(): void {
    clearTimeout(this.restartTimer);
    this.restarts = 0;
    const proc = this.proc;
    this.proc = null;
    proc?.kill();
    this.setCurrent('');
  }

  private setCurrent(text: string): void {
    if (text === this.current) return;
    this.current = text;
    this.onChange(text);
  }
}
