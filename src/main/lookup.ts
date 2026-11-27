import { readFileSync } from 'node:fs';
import { convert, pinyin } from 'pinyin-pro';
import type { CharInfo, Direction, EnglishMatch, Lang, LookupResult, WordInfo } from '../shared/types';

const HAN = /\p{Script=Han}/u;
const MAX_WORD_LEN = 8;

export const hasHan = (s: string): boolean => HAN.test(s);

/** Copied links, emails and file paths aren't English to learn. */
const NOT_PROSE = /:\/\/|^www\.|\S@\S|^[~/]\S*\//i;

/**
 * Which mode copied or highlighted text opens: 'zh' for anything with Chinese characters, 'en' for
 * English (Latin letters, no Chinese, not a link), null for anything else.
 */
export function detectLang(text: string): Lang | null {
  if (hasHan(text)) return 'zh';
  if (/[A-Za-z]/.test(text) && !NOT_PROSE.test(text)) return 'en';
  return null;
}

interface DictEntry {
  simp: string;
  /** Normalized numbered pinyin, e.g. "xi3 huan0". */
  reading: string;
  /** Reading as written in CC-CEDICT, e.g. "xi3 huan5" (keeps capitals for proper nouns). */
  rawReading: string;
  defs: string[];
}

/** "xi3 huan5" → "xǐhuan", "nu:3 er2" → "nǚér". */
export function numberedToMarks(reading: string): string {
  const syllables = reading
    .replace(/u:/gi, (m) => (m[0] === 'U' ? 'Ü' : 'ü'))
    .split(/\s+/)
    .filter(Boolean)
    .map((syl) => (/[05]$/.test(syl) ? syl.slice(0, -1) : syl));
  return syllables
    .map((syl) => convert(syl, { format: 'numToSymbol' }).replace(/\d$/, ''))
    .join('')
    .replace(/\s*,\s*/g, ', ');
}

/**
 * Lowercase, no brackets, no leading "to"/"a"/"the", so "to eat" matches "eat" and
 * "apple (fruit)" matches "apple".
 */
export function normalizeGloss(s: string): string {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/[^\p{L}\p{N}'\- ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(to|a|an|the|be) (?=\S)/, '');
}

const SKIP_GLOSS = /^(surname |variant of |old variant of |see |used in |cl:|abbr\. for |erhua variant)/i;

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

const isSecondary = (e: DictEntry) =>
  e.defs.every((d) => /^(surname |variant of |old variant of |see |used in )/i.test(d));

export class Dictionary {
  private readonly map = new Map<string, DictEntry[]>();
  /** Every entry once (simplified form), for English search. */
  private readonly entries: DictEntry[] = [];
  private glosses: Array<{ entry: DictEntry; defIndex: number; gloss: string }> | null = null;
  /** Character → entries that contain it. */
  private byChar: Map<string, DictEntry[]> | null = null;
  private readonly usage = new Map<string, number>();

  /** With no file the dictionary is empty: everything still works, with no word meanings. */
  constructor(file?: string) {
    if (!file) return;
    const re = /^(\S+) (\S+) \[([^\]]*)\] \/(.*)\/\s*$/;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line || line.startsWith('#')) continue;
      const m = re.exec(line);
      if (!m) continue;
      const [, trad, simp, reading, defsRaw] = m;
      const entry: DictEntry = {
        simp,
        reading: normalizeReading(reading),
        rawReading: reading,
        defs: defsRaw.split('/').filter(Boolean),
      };
      this.entries.push(entry);
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

  /** Splits text into runs of Han and non-Han characters. Returns [start, end) ranges over `chars`. */
  segment(chars: string[]): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    let i = 0;
    while (i < chars.length) {
      const isHan = HAN.test(chars[i]);
      let j = i + 1;
      while (j < chars.length && HAN.test(chars[j]) === isHan) j++;
      if (isHan) out.push(...this.segmentHan(chars, i, j));
      else out.push([i, j]);
      i = j;
    }
    return out;
  }

  /**
   * Picks the split with the fewest words, then the most even word lengths (lowest sum of squares).
   * Greedy matching reads 研究生命 as 研究生 + 命; this reads it as 研究 + 生命. Remaining ties go to
   * the longer first word.
   */
  private segmentHan(chars: string[], start: number, end: number): Array<[number, number]> {
    const best: Array<{ words: number; squares: number; next: number }> = [];
    best[end] = { words: 0, squares: 0, next: end };
    for (let i = end - 1; i >= start; i--) {
      for (let len = Math.min(MAX_WORD_LEN, end - i); len >= 1; len--) {
        if (len > 1 && !this.has(chars.slice(i, i + len).join(''))) continue;
        const rest = best[i + len];
        const words = rest.words + 1;
        const squares = rest.squares + len * len;
        const current = best[i];
        if (!current || words < current.words || (words === current.words && squares < current.squares)) {
          best[i] = { words, squares, next: i + len };
        }
      }
    }
    const out: Array<[number, number]> = [];
    for (let i = start; i < end; i = best[i].next) out.push([i, best[i].next]);
    return out;
  }

  /** Built on first English search, so Chinese lookups don't pay for it. */
  private glossIndex() {
    if (this.glosses) return this.glosses;
    this.glosses = [];
    for (const entry of this.entries) {
      entry.defs.forEach((def, defIndex) => {
        if (SKIP_GLOSS.test(def)) return;
        for (const part of def.split(';')) {
          const gloss = normalizeGloss(part);
          if (gloss) this.glosses!.push({ entry, defIndex, gloss });
        }
      });
    }
    return this.glosses;
  }

  /**
   * How common a word is, approximated by how many dictionary entries contain it (猫 is in dozens,
   * slang like 哈基米 in none). CC-CEDICT has no frequency data of its own.
   */
  private commonness(word: string): number {
    const cached = this.usage.get(word);
    if (cached !== undefined) return cached;
    if (!this.byChar) {
      this.byChar = new Map();
      for (const e of this.entries) {
        for (const c of new Set(Array.from(e.simp))) {
          const list = this.byChar.get(c);
          if (list) list.push(e);
          else this.byChar.set(c, [e]);
        }
      }
    }
    const lists = Array.from(word, (c) => this.byChar!.get(c) ?? []);
    const rarest = lists.reduce((a, b) => (b.length < a.length ? b : a));
    const count = rarest.filter((e) => e.simp.includes(word)).length;
    this.usage.set(word, count);
    return count;
  }

  /**
   * Chinese words whose English meaning matches `query` (offline). Exact meanings come first
   * ("eat" → 吃), then meanings that contain the query as a whole word ("eat" → 吃饭 "to eat a meal").
   */
  english(query: string, limit = 8): EnglishMatch[] {
    const q = normalizeGloss(query);
    if (!q || q.split(' ').length > 4) return [];
    // normalizeGloss leaves only letters, digits, spaces, ' and -, so only - needs escaping.
    const whole = new RegExp(`(^|[ -])${q.replace(/-/g, '\\-')}($|[ -])`);
    const best = new Map<string, { entry: DictEntry; rank: number[] }>();
    for (const { entry, defIndex, gloss } of this.glossIndex()) {
      const exact = gloss === q;
      if (!exact && !whole.test(gloss)) continue;
      const len = Array.from(entry.simp).length;
      const rank = [
        exact ? 0 : 1,
        Math.min(defIndex, 2), // a word's first meaning beats its third
        exact ? 0 : gloss.length, // "eat a meal" beats "eat one's words"
        len > 4 ? 1 : 0, // idioms after ordinary words
        /^[A-Z]/.test(entry.rawReading) ? 1 : 0, // 苹果 the fruit before 苹果 the company
        -this.commonness(entry.simp),
        len,
      ];
      const previous = best.get(entry.simp);
      if (!previous || compareRanks(rank, previous.rank) < 0) best.set(entry.simp, { entry, rank });
    }
    return [...best.values()]
      .sort((a, b) => compareRanks(a.rank, b.rank))
      .slice(0, limit)
      .map(({ entry }) => ({
        hanzi: entry.simp,
        pinyin: numberedToMarks(entry.rawReading),
        defs: this.definitions(entry.simp, entry.reading).slice(0, 4),
      }));
  }

  lookup(input: string): LookupResult {
    const text = input.trim();
    const chars = Array.from(text);
    // Run pinyin over the whole phrase so polyphonic characters get context (银行 háng vs 行走 xíng).
    const marked = pinyin(text, { type: 'all' });
    // Dictionary readings use base tones (不是 bu4 shi4), so match against those rather than the spoken bú shì.
    const numbered = pinyin(text, { type: 'array', toneType: 'num', toneSandhi: false });

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
        // A character pinyin-pro doesn't know (𠮷) stays visible instead of vanishing from the line.
        pinyin: wc.map((c) => c.pinyin || c.char).join(''),
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

    return { text, pinyin: phrasePinyin, words, lang: 'zh' };
  }
}

function compareRanks(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

/** zh-en: Chinese to English (the card). en-zh: English to Simplified Chinese (the Translate tab). */
export type { Direction };
const LANGS: Record<Direction, [string, string]> = { 'zh-en': ['zh-CN', 'en'], 'en-zh': ['en', 'zh-CN'] };

type Provider = (text: string, fetchImpl: FetchLike, direction: Direction) => Promise<string | null>;

/** Google Translate's free endpoint (no key). */
const google: Provider = async (text, fetchImpl, direction) => {
  const [sl, tl] = LANGS[direction];
  const url =
    `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=` +
    encodeURIComponent(text);
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
  const data = (await res.json()) as unknown;
  const segments = Array.isArray(data) && Array.isArray(data[0]) ? (data[0] as unknown[][]) : [];
  return segments.map((s) => (typeof s[0] === 'string' ? s[0] : '')).join('').trim() || null;
};

/** MyMemory free API (no key, ~5000 chars/day anonymous). */
const myMemory: Provider = async (text, fetchImpl, direction) => {
  const [sl, tl] = LANGS[direction];
  const url = `https://api.mymemory.translated.net/get?langpair=${sl}%7C${tl}&q=` + encodeURIComponent(text);
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) return null;
  const data = (await res.json()) as { responseStatus?: number; responseData?: { translatedText?: string } };
  if (data.responseStatus !== 200) return null;
  return data.responseData?.translatedText?.trim() || null;
};

const HEDGE_AFTER_MS = 1500;
const translationCache = new Map<string, string>();

const attempt = (provider: Provider, text: string, fetchImpl: FetchLike, direction: Direction) =>
  provider(text, fetchImpl, direction).then((r) => r ?? Promise.reject(new Error('empty translation')));

/**
 * Whole-phrase translation. Google goes first; if it fails or hasn't answered within 1.5s, MyMemory is
 * asked too and the first good answer wins. Returns null when offline or both fail.
 */
export async function translate(
  text: string,
  fetchImpl: FetchLike = fetch,
  direction: Direction = 'zh-en',
): Promise<string | null> {
  const query = text.trim();
  if (!query) return null;
  const key = `${direction}:${query}`;
  const cached = translationCache.get(key);
  if (cached) return cached;

  const primary = attempt(google, query, fetchImpl, direction);
  const hedge = new Promise<string>((resolve, reject) => {
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      attempt(myMemory, query, fetchImpl, direction).then(resolve, reject);
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
