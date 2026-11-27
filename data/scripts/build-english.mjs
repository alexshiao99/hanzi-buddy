// Builds data/processed/english.tsv (the app's English word list) from the untouched raw files in
// data/raw/ (see data/datasets.csv):
// - ECDICT: words, Chinese meanings, inflections, frequency. Keeps common words (with a frequency rank,
//   exam tag, Oxford 3000 or Collins stars), inflected forms whose lemma is a common word (went → go),
//   and common phrases of up to 3 words (a lot).
// - Britfone: British 音标 for ~16,000 common words, in modern IPA. Other words get ECDICT's 音标,
//   converted from its older notation to modern IPA.
// - CMUdict: American 音标.
// Regular inflections missing from a source (books, watches) get their base word's 音标 plus the ending.
//
// Columns: word, ipa (British), chinese (meanings joined with \n), tag, rank (lower = more common;
// 999999 = unranked), lemma, ipa_us (American).
//
// Usage: node data/scripts/build-english.mjs
import { createReadStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { arpabetToIpa, britfoneToIpa, cleanIpa, inflectIpa, modernizeIpa } from '../../src/shared/pronunciation.ts';

const RAW = 'data/raw/ecdict/ecdict.csv';
const BRITFONE = 'data/raw/britfone/britfone.main.3.0.1.csv';
const CMUDICT = 'data/raw/cmudict/cmudict.dict';
const OUT = 'data/processed/english.tsv';
const UNRANKED = 999999;

/** Minimal RFC 4180 reader: quoted fields may contain commas, "" and real newlines. */
async function* records(file) {
  const lines = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
  let fields = [];
  let field = '';
  let quoted = false;
  for await (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quoted) {
        if (c === '"' && line[i + 1] === '"') (field += '"'), i++;
        else if (c === '"') quoted = false;
        else field += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') fields.push(field), (field = '');
      else field += c;
    }
    if (quoted) {
      field += '\n';
      continue;
    }
    fields.push(field);
    yield fields;
    fields = [];
    field = '';
  }
}

/** Lowercase word → all its pronunciations in source order (Britfone's WORD(1), WORD(2); CMUdict's word(2)). */
function variants(lines, split, convert) {
  const map = new Map();
  for (const line of lines) {
    const parts = split(line);
    if (!parts) continue;
    const word = parts[0].replace(/\(\d+\)$/, '').replace(/_/g, ' ').toLowerCase();
    const ipa = convert(parts[1]);
    if (!ipa) continue;
    const list = map.get(word);
    if (list) list.push(ipa);
    else map.set(word, [ipa]);
  }
  return map;
}

const britfone = variants(
  readFileSync(BRITFONE, 'utf8').split('\n'),
  (line) => {
    const i = line.indexOf(',');
    return i > 0 ? [line.slice(0, i), line.slice(i + 1)] : null;
  },
  britfoneToIpa,
);
const cmudict = variants(
  readFileSync(CMUDICT, 'utf8').split('\n'),
  (line) => {
    const i = line.indexOf(' ');
    return i > 0 ? [line.slice(0, i), line.slice(i + 1).replace(/#.*/, '')] : null;
  },
  arpabetToIpa,
);

/**
 * With several pronunciations (construct: ˈkɒnstrʌkt n. / kənˈstrʌkt v.) take the one stressed like
 * ECDICT's, so the 音标 agrees with the meanings shown next to it.
 */
function pick(list, ecdictIpa) {
  if (!list?.length) return '';
  if (list.length === 1 || !ecdictIpa) return list[0];
  const initial = (s) => s.startsWith('ˈ');
  return list.find((v) => initial(v) === initial(ecdictIpa)) ?? list[0];
}

const rows = new Map();
let header;
for await (const rec of records(RAW)) {
  if (!header) {
    header = rec;
    continue;
  }
  const r = Object.fromEntries(header.map((h, i) => [h, rec[i] ?? '']));
  if (r.translation.trim()) rows.set(r.word, r);
}

const rankOf = (r) => {
  const ranks = [Number(r.frq) || 0, Number(r.bnc) || 0].filter((n) => n > 0);
  return ranks.length ? Math.min(...ranks) : UNRANKED;
};
const isCommon = (r) => rankOf(r) < UNRANKED || r.tag.trim() || r.oxford.trim() || r.collins.trim();
const lemmaOf = (r) => (r.exchange.split('/').find((p) => p.startsWith('0:')) ?? '').slice(2);

const common = new Set([...rows.values()].filter((r) => !r.word.includes(' ') && isCommon(r)).map((r) => r.word));
const keep = [];
for (const r of rows.values()) {
  const words = r.word.split(' ');
  const lemma = lemmaOf(r);
  const single = words.length === 1;
  if (single && common.has(r.word)) keep.push(r);
  else if (single && lemma && common.has(lemma)) keep.push(r);
  else if (!single && words.length <= 3 && isCommon(r) && words.every((w) => common.has(w) || common.has(w.toLowerCase()))) keep.push(r);
}

/** The base word's exchange column says which kind of ending a form is: book has s:books. */
function kindOf(form, base) {
  const part = base.exchange.split('/').find((p) => p.split(':')[1] === form);
  return part ? part.split(':')[0] : '';
}
/** Only forms spelled base + ending fit the regular rule (books, tried); not went or children. */
const isRegular = (form, base) => form.toLowerCase().startsWith(base.toLowerCase().replace(/e$|y$/, ''));

/** A word's own British and American 音标, before any inflection rule. */
function ownIpa(word, ecdictPhonetic) {
  const ecdict = modernizeIpa(cleanIpa(ecdictPhonetic));
  const key = word.toLowerCase();
  return { uk: pick(britfone.get(key), ecdict) || ecdict, us: pick(cmudict.get(key), ecdict) };
}

/** For an inflection a source has no 音标 for (ECDICT has books with an empty one): the base word's plus the ending. */
function ipaOf(r) {
  const own = ownIpa(r.word, r.phonetic);
  const lemma = lemmaOf(r);
  const base = lemma && rows.get(lemma);
  if ((own.uk && own.us) || !base || !isRegular(r.word, lemma)) return own;
  const kind = kindOf(r.word, base);
  const fromBase = ownIpa(base.word, base.phonetic);
  return { uk: own.uk || inflectIpa(fromBase.uk, kind, 'uk'), us: own.us || inflectIpa(fromBase.us, kind, 'us') };
}

// Regular inflections with no ECDICT row of their own (listed only in the base word's exchange column).
const LABELS = { s: '的复数', 3: '的第三人称单数', p: '的过去式', d: '的过去分词', i: '的现在分词', r: '的比较级', t: '的最高级' };
const have = new Set(keep.map((r) => r.word));
const added = [];
for (const r of keep) {
  if (r.word.includes(' ') || lemmaOf(r) || !common.has(r.word)) continue;
  for (const part of r.exchange.split('/')) {
    const [kind, form] = part.split(':');
    if (!LABELS[kind] || !form || have.has(form)) continue;
    const own = ownIpa(form, '');
    const base = ownIpa(r.word, r.phonetic);
    const regular = isRegular(form, r.word);
    added.push({
      word: form,
      uk: own.uk || (regular ? inflectIpa(base.uk, kind, 'uk') : ''),
      us: own.us || (regular ? inflectIpa(base.us, kind, 'us') : ''),
      translation: `${r.word}${LABELS[kind]}`,
      lemma: r.word,
      rank: rankOf(r),
    });
    have.add(form);
  }
}

const tsv = (s) => s.replace(/[\t\r]/g, ' ').replace(/\n/g, '\\n').trim();
let fromBritfone = 0;
const out = [
  ...keep.map((r) => {
    const { uk, us } = ipaOf(r);
    if (britfone.has(r.word.toLowerCase())) fromBritfone++;
    return [r.word, uk, r.translation.replace(/\\n/g, '\n'), r.tag, rankOf(r), lemmaOf(r), us];
  }),
  ...added.map((r) => [r.word, r.uk, r.translation, '', r.rank, r.lemma, r.us]),
].map((cols) => cols.map((v) => tsv(String(v))).join('\t'));
mkdirSync('data/processed', { recursive: true });
writeFileSync(
  OUT,
  '# word\tipa\tchinese\ttag\trank\tlemma\tipa_us\n' +
    '# Built by data/scripts/build-english.mjs from ECDICT (MIT, github.com/skywind3000/ECDICT), ' +
    'Britfone (MIT, github.com/JoseLlarena/Britfone) and the CMU Pronouncing Dictionary (BSD-style, github.com/cmusphinx/cmudict)\n' +
    `${out.join('\n')}\n`,
);
const missing = (col) => out.filter((l) => !l.split('\t')[col]).length;
console.log(
  `saved ${OUT}: ${out.length} entries (${common.size} common words, ${added.length} regular inflections added); ` +
    `British from Britfone: ${fromBritfone}; no British 音标: ${missing(1)}; no American 音标: ${missing(6)}`,
);
