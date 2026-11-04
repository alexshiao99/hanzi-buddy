import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';

/**
 * Runs the native selection-watcher helper, which reports text highlighted in the frontmost app
 * (only when it contains Chinese). Requires the Accessibility permission.
 */
export class SelectionWatcher {
  private proc: ChildProcess | null = null;
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
    const proc = spawn(this.binPath, [], { stdio: ['pipe', 'pipe', 'ignore'] });
    this.proc = proc;
    createInterface({ input: proc.stdout! }).on('line', (line) => {
      try {
        const text = JSON.parse(line) as unknown;
        if (typeof text !== 'string' || text === this.current) return;
        this.current = text;
        this.onChange(text);
      } catch {
        // ignore malformed lines
      }
    });
    proc.on('exit', () => {
      if (this.proc === proc) this.proc = null;
      this.setCurrent('');
    });
  }

  stop(): void {
    this.proc?.kill();
    this.proc = null;
    this.setCurrent('');
  }

  private setCurrent(text: string): void {
    if (text === this.current) return;
    this.current = text;
    this.onChange(text);
  }
}
