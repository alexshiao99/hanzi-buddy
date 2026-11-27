/**
 * English pronunciation (音标) in the IPA style of today's Chinese textbooks and the Oxford/Cambridge
 * learner's dictionaries: British /ˈbɔːdə/, American /ˈbɔːrdər/, stress marked at the start of the
 * stressed syllable.
 *
 * Used by data/scripts/build-english.mjs (run directly by Node, so this file sticks to type syntax
 * Node can strip: no enums or parameter properties) and by the tests.
 */

const CONSONANTS = new Set([
  'b', 'd', 'dʒ', 'f', 'ɡ', 'h', 'j', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'tʃ', 'v', 'w', 'z', 'ð', 'ŋ', 'θ', 'ʃ', 'ʒ',
]);

/** Consonant clusters English allows at the start of a syllable (where the stress mark goes). */
const ONSETS = new Set([
  ...[...CONSONANTS].filter((c) => c !== 'ŋ'),
  ...'pl bl kl ɡl fl sl pr br tr dr kr ɡr fr θr ʃr tw dw kw ɡw sw θw sp st sk sm sn sf'.split(' ').map((p) => [...p].join(' ')),
  ...'pj bj tj dj kj ɡj mj nj fj vj θj sj hj lj zj'.split(' ').map((p) => [...p].join(' ')),
  's p l', 's p r', 's t r', 's k r', 's k w', 's k l', 's p j', 's t j', 's k j',
]);

interface Phone {
  sound: string;
  /** Only on vowels: ˈ primary, ˌ secondary. */
  stress: '' | 'ˈ' | 'ˌ';
}

/**
 * Joins phonemes into a transcription with each stress mark moved from its vowel to the start of the
 * syllable: b ˈɔː d ə → ˈbɔːdə, ɪ n ˈt r ɒ → ɪnˈtrɒ. The syllable takes the longest consonant
 * cluster before the vowel that English allows at the start of a syllable.
 */
export function joinWithStress(phones: Phone[]): string {
  // One-syllable words carry no stress mark in dictionaries: kʌp, not ˈkʌp.
  if (phones.filter((p) => !CONSONANTS.has(p.sound)).length <= 1) return phones.map((p) => p.sound).join('');
  const marks = new Map<number, string>();
  let lastVowel = -1;
  let pastPrimary = false;
  phones.forEach((p, i) => {
    if (CONSONANTS.has(p.sound)) return;
    // Learner's dictionaries mark no secondary stress after the main one: ˈbɒrəʊd, not ˈbɒˌrəʊd.
    const stress = p.stress === 'ˌ' && pastPrimary ? '' : p.stress;
    if (p.stress === 'ˈ') pastPrimary = true;
    if (stress) {
      let start = i;
      const earliest = lastVowel + 1;
      for (let s = earliest; s < i; s++) {
        const cluster = phones.slice(s, i).map((q) => q.sound).join(' ');
        if (lastVowel < 0 || ONSETS.has(cluster)) {
          start = s;
          break;
        }
      }
      marks.set(start, stress);
    }
    lastVowel = i;
  });
  return phones.map((p, i) => (marks.get(i) ?? '') + p.sound).join('');
}

/** Britfone's symbols → textbook ones: ɹ → r, ɛ → e, ɐ → ʌ (the vowel in cup). */
const BRITFONE: Record<string, string> = { ɹ: 'r', ɛ: 'e', ɛə: 'eə', ɐ: 'ʌ', g: 'ɡ' };

/** "b ˈɔː d ə" (Britfone) → "ˈbɔːdə". */
export function britfoneToIpa(phones: string): string {
  return joinWithStress(
    phones
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => {
        const stress = p[0] === 'ˈ' || p[0] === 'ˌ' ? (p[0] as Phone['stress']) : '';
        const sound = stress ? p.slice(1) : p;
        return { sound: BRITFONE[sound] ?? sound, stress };
      }),
  );
}

/** CMUdict (ARPAbet) → American IPA as in the Oxford Learner's Dictionaries' NAmE transcriptions. */
const ARPABET: Record<string, string | [unstressed: string, stressed: string]> = {
  AA: 'ɑː', AE: 'æ', AH: ['ə', 'ʌ'], AO: 'ɔː', AW: 'aʊ', AY: 'aɪ', EH: 'e', ER: ['ər', 'ɜːr'], EY: 'eɪ',
  IH: 'ɪ', IY: ['i', 'iː'], OW: 'oʊ', OY: 'ɔɪ', UH: 'ʊ', UW: ['u', 'uː'],
  B: 'b', CH: 'tʃ', D: 'd', DH: 'ð', F: 'f', G: 'ɡ', HH: 'h', JH: 'dʒ', K: 'k', L: 'l', M: 'm', N: 'n', NG: 'ŋ',
  P: 'p', R: 'r', S: 's', SH: 'ʃ', T: 't', TH: 'θ', V: 'v', W: 'w', Y: 'j', Z: 'z', ZH: 'ʒ',
};

/** "B AO1 R D ER0" (CMUdict) → "ˈbɔːrdər". */
export function arpabetToIpa(phones: string): string {
  const out: Phone[] = [];
  let pastPrimary = false;
  for (const token of phones.trim().split(/\s+/)) {
    const m = /^([A-Z]+)([012])?$/.exec(token);
    if (!m) continue;
    const [, code] = m;
    let level = m[2];
    const sound = ARPABET[code];
    if (!sound) continue;
    // Secondary stress after the main one isn't marked (joinWithStress drops it), and its i/u take the
    // weak form as in learner's dictionaries: library L AY1 B R EH0 R IY2 → ˈlaɪbreri. Other vowels
    // keep their full quality: homework HH OW1 M W ER2 K → ˈhoʊmwɜːrk.
    if (level === '2' && pastPrimary && (code === 'IY' || code === 'UW')) level = '0';
    if (level === '1') pastPrimary = true;
    const stressed = level === '1' || level === '2';
    out.push({
      sound: Array.isArray(sound) ? sound[stressed ? 1 : 0] : sound,
      stress: level === '1' ? 'ˈ' : level === '2' ? 'ˌ' : '',
    });
  }
  // "ɜːr" and "ər" carry their own r; split it off so syllable starts see it as a consonant.
  const phonesOut = out.flatMap((p) => (p.sound.endsWith('r') && p.sound.length > 1 ? [{ ...p, sound: p.sound.slice(0, -1) }, { sound: 'r', stress: '' as const }] : [p]));
  return joinWithStress(phonesOut);
}

/** ECDICT writes stress and length in ASCII and sometimes uses Cyrillic look-alikes for ə and e. */
export function cleanIpa(s: string): string {
  return s
    .split(/[.;]\s/)[0] // "ˈwɔntid. ˈwɔːn-": keep the first variant
    .trim()
    .replace(/'/g, 'ˈ')
    .replace(/[,.]/g, 'ˌ') // ECDICT writes secondary stress as , or . (.ɪntrəˈdjuːs)
    .replace(/:/g, 'ː')
    .replace(/ә/g, 'ə') // Cyrillic schwa
    .replace(/є/g, 'ɛ') // Cyrillic ie
    .replace(/g/g, 'ɡ');
}

/**
 * ECDICT's older notation (go ɡou, I ai, sit sit) → modern IPA (ɡəʊ, aɪ, sɪt). Placeholders keep
 * one rule's output from being rewritten by a later one.
 */
export function modernizeIpa(ipa: string): string {
  const LONG = '\u0001'; // ː
  const SHORT_I = '\u0002'; // ɪ
  const SHORT_U = '\u0003'; // ʊ
  const swaps: Array<[RegExp, string]> = [
    [/[ɒɔ]ː/g, `ɔ${LONG}`],
    [/[əɜ]ː/g, `ɜ${LONG}`],
    [/ei/g, `e${SHORT_I}`],
    [/ai/g, `a${SHORT_I}`],
    [/[ɔɒ]i/g, `ɔ${SHORT_I}`],
    [/au/g, `a${SHORT_U}`],
    [/[əo]u/g, `ə${SHORT_U}`],
    [/iə/g, `${SHORT_I}ə`],
    [/[ɛε]ə/g, 'eə'],
    [/uə/g, `${SHORT_U}ə`],
    [/[ɛε]/g, 'e'],
    [new RegExp(`ɔ(?!${LONG}|${SHORT_I})`, 'g'), 'ɒ'], // short o
    [/iː/g, `i${LONG}`],
    [/uː/g, `u${LONG}`],
    [new RegExp(`i(?!${LONG})(?=.)`, 'g'), SHORT_I], // short i, except happY at the end
    [new RegExp(`u(?!${LONG})`, 'g'), SHORT_U],
  ];
  let s = ipa;
  for (const [re, to] of swaps) s = s.replace(re, to);
  return s.replaceAll(LONG, 'ː').replaceAll(SHORT_I, 'ɪ').replaceAll(SHORT_U, 'ʊ');
}

const VOICELESS = /[ptkfθ]$/;
const SIBILANT = /(s|z|ʃ|ʒ|tʃ|dʒ)$/;

/**
 * Regular endings: -s is /s/ /z/ /ɪz/, -ed is /t/ /d/ /ɪd/, -ing /ɪŋ/, -er /ə(r)/, -est /ɪst/.
 * `kind` is ECDICT's exchange code (s plural, 3 third person, p past, d past participle, i -ing,
 * r comparative, t superlative).
 */
export function inflectIpa(ipa: string, kind: string, accent: 'uk' | 'us' = 'uk'): string {
  if (!ipa) return '';
  const base = ipa.trimEnd();
  if (kind === 's' || kind === '3') return base + (SIBILANT.test(base) ? 'ɪz' : VOICELESS.test(base) ? 's' : 'z');
  if (kind === 'p' || kind === 'd') return base + (/[td]$/.test(base) ? 'ɪd' : VOICELESS.test(base) || /(ʃ|tʃ|s)$/.test(base) ? 't' : 'd');
  if (kind === 'i') return base + 'ɪŋ';
  if (kind === 'r') return base + (accent === 'us' ? 'ər' : 'ə');
  if (kind === 't') return base + 'ɪst';
  return '';
}
