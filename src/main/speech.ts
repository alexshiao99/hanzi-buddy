import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import type { Voice } from '../shared/types';

/** Preferred macOS voices, then any installed voice for the locale. */
const VOICES: Record<Voice, { preferred: string[]; locale: string }> = {
  zh: { preferred: ['Tingting', 'Shelley (Chinese (China mainland))', 'Flo (Chinese (China mainland))'], locale: 'zh_CN' },
  'en-GB': { preferred: ['Daniel', 'Kate', 'Serena'], locale: 'en_GB' },
  'en-US': { preferred: ['Samantha', 'Alex', 'Ava'], locale: 'en_US' },
};

const picked = new Map<Voice, string | null>();
let installed: string | undefined;
let current: ChildProcess | null = null;

function pickVoice(voice: Voice): string | null {
  if (picked.has(voice)) return picked.get(voice)!;
  let name: string | null = null;
  try {
    installed ??= execFileSync('say', ['-v', '?'], { encoding: 'utf8' });
    const { preferred, locale } = VOICES[voice];
    name = preferred.find((v) => installed!.includes(`${v} `)) ?? null;
    if (!name) {
      const line = installed.split('\n').find((l) => new RegExp(`\\s${locale}\\s`).test(l));
      name = line ? line.split(/\s{2,}/)[0].trim() : null;
    }
  } catch {
    name = null;
  }
  picked.set(voice, name);
  return name;
}

export function speak(text: string, slow: boolean, voice: Voice = 'zh'): Promise<void> {
  stopSpeaking();
  const v = pickVoice(voice);
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
