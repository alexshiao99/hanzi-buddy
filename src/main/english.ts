import { readFileSync } from 'node:fs';
import type { EnglishMatch, LookupResult, WordInfo } from '../shared/types';

/**
 * English lookups for Chinese speakers learning English (the EN→中 mirror of `Dictionary`), from
 * data/processed/english.tsv (built from ECDICT by data/scripts/build-english.mjs).
 *
 * Results reuse the Chinese shapes so the card can render both the same way: in an English
 * LookupResult a word's `hanzi` is the English word, `pinyin` its IPA (音标) and `defs` its Chinese
 * meanings; `isHan` means "is a word" (punctuation and spaces are false).
 */

interface Entry {
  word: string;
  /** British 音标 (Britfone, or ECDICT converted to modern IPA). */
  ipa: string;
  /** American 音标 (CMUdict). */
  ipaUs: string;
  /** Chinese meanings, one per line as in ECDICT ("a. 快乐的, 幸福的"). */
  zh: string[];
  tag: string;
  /** Lower is more common. */
  rank: number;
  /** Base form for inflections: went → go. */
  lemma: string;
}

const MAX_PHRASE_WORDS = 3;
/** Words, with inner apostrophes and hyphens: don't, well-known, rock'n'roll. */
const WORD = /[A-Za-z]+(?:['’][A-Za-z]+)*(?:-[A-Za-z]+)*/g;

/** "a. 快乐的, 幸福的" → ["快乐的", "幸福的"]. */
function terms(line: string): string[] {
  return line
    .replace(/^[a-z]+\.\s*/i, '')
    .replace(/\[[^\]]*\]\s*/g, '')
    // Notes in brackets go before splitting: yarmulke is "(犹太男子在祷告,学习,吃饭等时戴的)圆顶小帽",
    // which must not become a meaning 学习.
    .replace(/[（(][^）)]*[）)]/g, '')
    .split(/[,，;；、]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Everyday meanings: specialist lines ("[计] 电流, 中断", "[医] …") only when a word has nothing else. */
function everyday(e: Entry): string[] {
  const plain = e.zh.filter((line) => !line.startsWith('['));
  return plain.length ? plain : e.zh;
}

/**
 * "/aɪ laɪk ˈkɒfi/": the phrase in one accent. Words without 音标 stay visible as written; punctuation
 * attaches to the word before, except at the very end.
 */
function phraseLine(words: WordInfo[], accent: 'pinyin' | 'pinyinUs'): string {
  let line = '';
  for (const w of words) {
    if (!w.isHan) {
      const punct = w.hanzi.trim();
      if (punct) line += punct;
      continue;
    }
    line += (line ? ' ' : '') + (w[accent] || w.hanzi);
  }
  line = line.replace(/[.!?…;:,]+$/, ''); // "/aɪ laɪk ˈkɒfi/", not "/aɪ laɪk ˈkɒfi./"
  return line ? `/${line}/` : '';
}

export class EnglishDictionary {
  /** Lowercase word or phrase → entries (several when only the case differs: US / us). */
  private readonly map = new Map<string, Entry[]>();
  private termIndex: Array<{ entry: Entry; terms: string[] }> | null = null;

  /** With no file the dictionary is empty: English lookups still get the online translation. */
  constructor(file?: string) {
    if (!file) return;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line || line.startsWith('#')) continue;
      const [word, ipa = '', zh = '', tag = '', rank = '', lemma = '', ipaUs = ''] = line.split('\t');
      const entry: Entry = { word, ipa, ipaUs, zh: zh.split('\\n').filter(Boolean), tag, rank: Number(rank) || 999999, lemma };
      const key = word.toLowerCase();
      const list = this.map.get(key);
      if (list) list.push(entry);
      else this.map.set(key, [entry]);
    }
  }

  get size(): number {
    return this.map.size;
  }

  /** Prefers the entry spelled exactly as written (Polish vs polish), then the most common one. */
  find(text: string): Entry | null {
    const word = text.replace(/’/g, "'");
    const list = this.map.get(word.toLowerCase());
    if (list) {
      const exact = list.find((e) => e.word === word);
      if (exact) return exact;
      const lower = list.find((e) => e.word === e.word.toLowerCase());
      return lower ?? [...list].sort((a, b) => a.rank - b.rank)[0];
    }
    if (/'s$/i.test(word)) return this.find(word.slice(0, -2)); // possessive: Tom's → Tom
    return null;
  }

  /**
   * Chinese meanings, plus the base word's when this is an inflection whose own entry is just "go的过去式".
   * Specialist lines ("[计] 电流, 中断" for I, "[医] …") are left out unless a word has nothing else.
   */
  private meanings(entry: Entry): string[] {
    const own = everyday(entry).slice(0, 4);
    const base = entry.lemma && entry.lemma !== entry.word ? this.find(entry.lemma) : null;
    if (!base) return own;
    return [...own, ...everyday(base).slice(0, 2).map((line) => `${base.word}: ${line}`)];
  }

  private wordInfo(text: string, entry: Entry | null): WordInfo {
    const ipa = entry?.ipa ?? '';
    return {
      hanzi: text,
      pinyin: ipa,
      pinyinUs: entry?.ipaUs ?? '',
      chars: [{ char: text, pinyin: ipa, tone: 0, isHan: true }],
      defs: entry ? this.meanings(entry) : [],
      isHan: true,
    };
  }

  /**
   * Splits English into words (matching phrases of up to 3 words first: "a lot") and everything in
   * between, each word with its 音标 and Chinese meanings.
   */
  lookup(input: string): LookupResult {
    const text = input.trim();
    const tokens: Array<{ text: string; isWord: boolean }> = [];
    let last = 0;
    for (const m of text.matchAll(WORD)) {
      if (m.index > last) tokens.push({ text: text.slice(last, m.index), isWord: false });
      tokens.push({ text: m[0], isWord: true });
      last = m.index + m[0].length;
    }
    if (last < text.length) tokens.push({ text: text.slice(last), isWord: false });

    const words: WordInfo[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (!token.isWord) {
        words.push({ hanzi: token.text, pinyin: '', chars: [], defs: [], isHan: false });
        continue;
      }
      // Phrases only across single spaces: tokens i, i+2, i+4 are words with " " between them.
      let matched = false;
      for (let n = MAX_PHRASE_WORDS; n >= 2 && !matched; n--) {
        const end = i + 2 * (n - 1);
        if (end >= tokens.length) continue;
        const parts = tokens.slice(i, end + 1);
        if (!parts.every((t, k) => (k % 2 === 0 ? t.isWord : t.text === ' '))) continue;
        const phrase = parts.map((t) => t.text).join('');
        const entry = this.find(phrase);
        if (!entry) continue;
        // A phrase's 音标 is its words' 音标, since the sources rarely have one for the phrase itself.
        const each = (accent: 'ipa' | 'ipaUs') =>
          entry[accent] || parts.filter((t) => t.isWord).map((t) => this.find(t.text)?.[accent] || t.text).join(' ');
        const ipa = each('ipa');
        words.push({
          ...this.wordInfo(phrase, entry),
          pinyin: ipa,
          pinyinUs: each('ipaUs'),
          chars: [{ char: phrase, pinyin: ipa, tone: 0, isHan: true }],
        });
        i = end;
        matched = true;
      }
      if (!matched) words.push(this.wordInfo(token.text, this.find(token.text)));
    }

    return { text, pinyin: phraseLine(words, 'pinyin'), pinyinUs: phraseLine(words, 'pinyinUs'), words, lang: 'en' };
  }

  /** Built on first search, so lookups don't pay for it. */
  private index() {
    if (this.termIndex) return this.termIndex;
    this.termIndex = [];
    for (const list of this.map.values()) {
      for (const entry of list) {
        if (entry.word.includes(' ') || entry.lemma) continue; // single base words only
        // Everyday meanings in their dictionary order (main sense first); specialist lines ([计] …) after.
        const everyday = entry.zh.filter((line) => !line.startsWith('['));
        const specialist = entry.zh.filter((line) => line.startsWith('['));
        this.termIndex.push({ entry, terms: [...everyday, ...specialist].flatMap(terms) });
      }
    }
    return this.termIndex;
  }

  /**
   * English words whose Chinese meaning matches `query` (offline; the mirror of `Dictionary.english()`).
   * Exact meanings come before meanings that contain the query (快乐 before 快乐的). Then words where it's
   * the main sense: for 边界, boundary (边界 is its first meaning) before border (third) before march
   * (seventh, after 三月 and 行军), however common march is. Frequency only breaks ties within those.
   */
  chinese(query: string, limit = 8): EnglishMatch[] {
    const q = query.trim();
    if (!q || Array.from(q).length > 8) return [];
    const isExact = (t: string) => t === q || t === `${q}的` || t === `使${q}`;
    const hits: Array<{ entry: Entry; rank: number[] }> = [];
    for (const { entry, terms: ts } of this.index()) {
      let at = ts.findIndex(isExact);
      const exact = at >= 0;
      // Otherwise a short meaning built around it (学习者, 快乐地), not a long one that happens to
      // mention it (yarmulke: "犹太人…学习…时戴的圆顶小帽").
      const qLen = Array.from(q).length;
      if (!exact) at = ts.findIndex((t) => t.includes(q) && Array.from(t).length <= qLen + 2);
      if (at < 0) continue;
      const sense = at === 0 ? 0 : at <= 2 ? 1 : 2; // main sense · one of the first few · further down
      // Rare words step back, so chic and trig (漂亮的 first) don't beat pretty.
      const rarity = entry.rank <= 5000 ? 0 : entry.rank <= 20000 ? 1 : 2;
      hits.push({ entry, rank: [exact ? 0 : 1, sense + rarity, entry.rank] });
    }
    return hits
      .sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] || a.rank[2] - b.rank[2])
      .slice(0, limit)
      .map(({ entry }) => ({ hanzi: entry.word, pinyin: entry.ipa, pinyinUs: entry.ipaUs, defs: everyday(entry).slice(0, 3) }));
  }
}
