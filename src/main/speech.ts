import { execFileSync, spawn, type ChildProcess } from 'node:child_process';

const PREFERRED_VOICES = ['Tingting', 'Shelley (Chinese (China mainland))', 'Flo (Chinese (China mainland))'];

let voice: string | null | undefined;
let current: ChildProcess | null = null;

/** Picks the first installed Mandarin (mainland) voice. */
function pickVoice(): string | null {
  if (voice !== undefined) return voice;
  try {
    const installed = execFileSync('say', ['-v', '?'], { encoding: 'utf8' });
    voice = PREFERRED_VOICES.find((v) => installed.includes(`${v} `)) ?? null;
    if (!voice) {
      const zh = installed.split('\n').find((l) => /\szh_CN\s/.test(l));
      voice = zh ? zh.split(/\s{2,}/)[0].trim() : null;
    }
  } catch {
    voice = null;
  }
  return voice;
}

export function speak(text: string, slow: boolean): Promise<void> {
  stopSpeaking();
  const v = pickVoice();
  // `--` keeps text that starts with a dash from being read as an option (`say -o` writes files).
  const args = [...(v ? ['-v', v] : []), '-r', slow ? '110' : '180', '--', text];
  return new Promise((resolve) => {
    const proc = spawn('say', args, { stdio: 'ignore' });
    current = proc;
    proc.on('exit', () => {
      if (current === proc) current = null;
      resolve();
    });
    proc.on('error', () => resolve());
  });
}

export function stopSpeaking(): void {
  current?.kill();
  current = null;
}
