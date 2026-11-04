import { readFileSync } from 'node:fs';
import { pinyin } from 'pinyin-pro';
import type { CharInfo, LookupResult, WordInfo } from '../shared/types';

const HAN = /\p{Script=Han}/u;
const MAX_WORD_LEN = 8;

export const hasHan = (s: string): boolean => HAN.test(s);

interface DictEntry {
  /** Normalized numbered pinyin, e.g. "xi3 huan0". */
  reading: string;
  defs: string[];
}

/** Lowercase, ü instead of u:, neutral tone as 0 — matches pinyin-pro's `toneType: 'num'` output. */
function normalizeReading(reading: string): string {
  return reading
    .toLowerCase()
    .replace(/u:/g, 'ü')
    .replace(/v/g, 'ü')
    .replace(/5/g, '0')
    .split(/\s+/)
    .map((syl) => (/\d$/.test(syl) ? syl : `${syl}0`))
    .join(' ');
}

const PUNCTUATION: Record<string, string> = {
  '，': ',', '。': '.', '！': '!', '？': '?', '；': ';', '：': ':', '、': ',',
  '（': '(', '）': ')', '“': '"', '”': '"', '‘': "'", '’': "'", '《': '"', '》': '"', '…': '…',
};
const toAsciiPunctuation = (s: string) => Array.from(s, (c) => PUNCTUATION[c] ?? c).join('');

const isSecondary =(e: DictEntry) =>
  e.defs.every((d) => /^(surname |variant of |old variant of |see |used in )/i.test(d));

export class Dictionary {
  private readonly map = new Map<string, DictEntry[]>();

  constructor(file: string) {
    const re = /^(\S+) (\S+) \[([^\]]*)\] \/(.*)\/\s*$/;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line || line.startsWith('#')) continue;
      const m = re.exec(line);
      if (!m) continue;
      const [, trad, simp, reading, defsRaw] = m;
      const entry: DictEntry = { reading: normalizeReading(reading), defs: defsRaw.split('/').filter(Boolean) };
      this.add(simp, entry);
      if (trad !== simp) this.add(trad, entry);
    }
  }

  private add(key: string, entry: DictEntry): void {
    const list = this.map.get(key);
    if (list) list.push(entry);
    else this.map.set(key, [entry]);
  }

  has(word: string): boolean {
    return this.map.has(word);
  }

  /** Definitions for `word`, preferring entries whose reading matches the in-context pinyin. */
  definitions(word: string, contextReading: string): string[] {
    const entries = this.map.get(word);
    if (!entries) return [];
    const matching = entries.filter((e) => e.reading === contextReading);
    const pool = matching.length > 0 ? matching : entries;
    const ordered = [...pool.filter((e) => !isSecondary(e)), ...pool.filter(isSecondary)];
    const defs: string[] = [];
    for (const e of ordered) for (const d of e.defs) if (!defs.includes(d)) defs.push(d);
    return defs.slice(0, 8);
  }

  /** Greedy longest-match segmentation. Returns [start, end) ranges over `chars`. */
  segment(chars: string[]): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    let i = 0;
    while (i < chars.length) {
      if (!HAN.test(chars[i])) {
        let j = i;
        while (j < chars.length && !HAN.test(chars[j])) j++;
        out.push([i, j]);
        i = j;
        continue;
      }
      let len = 1;
      for (let l = Math.min(MAX_WORD_LEN, chars.length - i); l > 1; l--) {
        if (this.has(chars.slice(i, i + l).join(''))) {
          len = l;
          break;
        }
      }
      out.push([i, i + len]);
      i += len;
    }
    return out;
  }

  lookup(input: string): LookupResult {
    const text = input.trim();
    const chars = Array.from(text);
    // Run pinyin over the whole phrase so polyphonic characters get context (银行 háng vs 行走 xíng).
    const marked = pinyin(text, { type: 'all' });
    const numbered = pinyin(text, { type: 'array', toneType: 'num' });

    const charInfos: CharInfo[] = chars.map((char, i) => {
      const isHan = HAN.test(char);
      return {
        char,
        isHan,
        pinyin: isHan ? marked[i]?.pinyin ?? '' : '',
        tone: isHan ? marked[i]?.num ?? 0 : 0,
      };
    });

    const words: WordInfo[] = this.segment(chars).map(([start, end]) => {
      const wc = charInfos.slice(start, end);
      const hanzi = chars.slice(start, end).join('');
      const isHan = wc.some((c) => c.isHan);
      return {
        hanzi,
        isHan,
        chars: wc,
        pinyin: wc.map((c) => c.pinyin).join(''),
        defs: isHan ? this.definitions(hanzi, numbered.slice(start, end).join(' ')) : [],
      };
    });

    // Join words with spaces, but attach punctuation to the preceding word: "màn, dànshì".
    let phrasePinyin = '';
    for (const w of words) {
      const part = w.isHan ? w.pinyin : toAsciiPunctuation(w.hanzi).trim();
      if (!part) continue;
      const attach = !w.isHan && /^[,.!?;:)\]…'"]/.test(part);
      phrasePinyin += phrasePinyin && !attach ? ` ${part}` : part;
    }

    return { text, pinyin: phrasePinyin, words };
  }
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

type Provider = (text: string, fetchImpl: FetchLike) => Promise<string | null>;

/** Google Translate's free endpoint (no key). */
const google: Provider = async (text, fetchImpl) => {
  const url =
    'https://translate.googleapis.com/translate_a/single?client=gtx&sl=zh-CN&tl=en&dt=t&q=' +
    encodeURIComponent(text);
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
  const data = (await res.json()) as unknown;
  const segments = Array.isArray(data) && Array.isArray(data[0]) ? (data[0] as unknown[][]) : [];
  return segments.map((s) => (typeof s[0] === 'string' ? s[0] : '')).join('').trim() || null;
};

/** MyMemory free API (no key, ~5000 chars/day anonymous). */
const myMemory: Provider = async (text, fetchImpl) => {
  const url = 'https://api.mymemory.translated.net/get?langpair=zh-CN%7Cen&q=' + encodeURIComponent(text);
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) return null;
  const data = (await res.json()) as { responseStatus?: number; responseData?: { translatedText?: string } };
  if (data.responseStatus !== 200) return null;
  return data.responseData?.translatedText?.trim() || null;
};

const HEDGE_AFTER_MS = 1500;
const translationCache = new Map<string, string>();

const attempt = (provider: Provider, text: string, fetchImpl: FetchLike) =>
  provider(text, fetchImpl).then((r) => r ?? Promise.reject(new Error('empty translation')));

/**
 * Whole-phrase translation. Google goes first; if it fails or hasn't answered within 1.5s, MyMemory is
 * asked too and the first good answer wins. Returns null when offline or both fail.
 */
export async function translate(text: string, fetchImpl: FetchLike = fetch): Promise<string | null> {
  const key = text.trim();
  if (!key) return null;
  const cached = translationCache.get(key);
  if (cached) return cached;

  const primary = attempt(google, key, fetchImpl);
  const hedge = new Promise<string>((resolve, reject) => {
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      attempt(myMemory, key, fetchImpl).then(resolve, reject);
    };
    const timer = setTimeout(start, HEDGE_AFTER_MS);
    primary.then(
      () => clearTimeout(timer), // primary won; never start the fallback
      () => {
        clearTimeout(timer);
        start();
      },
    );
  });

  try {
    const result = await Promise.any([primary, hedge]);
    translationCache.set(key, result);
    return result;
  } catch {
    return null;
  }
}
