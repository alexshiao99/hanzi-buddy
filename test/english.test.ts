import assert from 'node:assert/strict';
import path from 'node:path';
import { before, describe, it } from 'node:test';
import { EnglishDictionary } from '../src/main/english';

// Built from ECDICT by data/scripts/build-english.mjs (npm install does this).
let dict: EnglishDictionary;
before(() => {
  dict = new EnglishDictionary(path.join(process.cwd(), 'data', 'processed', 'english.tsv'));
});

const words = (text: string) => dict.lookup(text).words.filter((w) => w.isHan);

describe('EnglishDictionary.lookup', () => {
  it('gives each word its 音标 and Chinese meanings', () => {
    const [happy] = words('happy');
    assert.equal(happy.hanzi, 'happy');
    assert.equal(happy.pinyin, 'ˈhæpi');
    assert.match(happy.defs[0], /快乐/);
    assert.equal(dict.lookup('happy').lang, 'en');
  });

  it('builds the whole-phrase 音标 line, keeping inner punctuation but not the full stop', () => {
    assert.equal(dict.lookup('I like coffee.').pinyin, '/aɪ laɪk ˈkɒfi/');
    assert.equal(dict.lookup('Yes, I like coffee').pinyin, '/jes, aɪ laɪk ˈkɒfi/');
  });

  it('adds the base word for inflections', () => {
    const [went] = words('went');
    assert.ok(went.defs.some((d) => d.startsWith('go: ')), went.defs.join(' | '));
  });

  it('keeps punctuation and spaces between words', () => {
    const result = dict.lookup("Hello, world! Don't panic.");
    assert.deepEqual(result.words.map((w) => w.hanzi).join(''), "Hello, world! Don't panic.");
    assert.deepEqual(words("Hello, world! Don't panic.").map((w) => w.hanzi), ['Hello', 'world', "Don't", 'panic']);
  });

  it('looks up possessives and case variants', () => {
    assert.ok(dict.find("teacher's"));
    assert.equal(dict.find('Happy')?.word, 'happy');
  });

  it('shows words it does not know without 音标 instead of dropping them', () => {
    const [w] = words('Zxqvbn');
    assert.equal(w.hanzi, 'Zxqvbn');
    assert.equal(w.pinyin, '');
    assert.deepEqual(w.defs, []);
  });
});

describe('EnglishDictionary.chinese', () => {
  it('finds English words by Chinese meaning, most common first', () => {
    const found = dict.chinese('快乐').map((m) => m.hanzi);
    assert.ok(found.slice(0, 5).includes('happy'), found.join(', '));
  });

  it('returns nothing for empty or very long queries', () => {
    assert.deepEqual(dict.chinese(''), []);
    assert.deepEqual(dict.chinese('这是一个非常非常长的句子'), []);
  });
});

describe('EnglishDictionary without a file', () => {
  it('still returns the words, with no 音标 or meanings', () => {
    const empty = new EnglishDictionary();
    assert.deepEqual(empty.lookup('hello there').words.filter((w) => w.isHan).map((w) => w.pinyin), ['', '']);
  });
});

describe('EnglishDictionary meanings', () => {
  it('leaves out specialist lines like [计] when a word has everyday meanings', () => {
    const [i] = dict.lookup('I').words.filter((w) => w.isHan);
    assert.ok(i.defs.length > 0);
    assert.ok(i.defs.every((d) => !d.startsWith('[')), i.defs.join(' | '));
  });
});

describe('EnglishDictionary phrases', () => {
  it('matches a known phrase as one word', () => {
    const found = dict.lookup('I like it a lot').words.filter((w) => w.isHan).map((w) => w.hanzi);
    assert.deepEqual(found, ['I', 'like', 'it', 'a lot']);
  });
});

describe('EnglishDictionary.chinese ranking', () => {
  it('puts words whose main sense matches before common words where it is a side sense', () => {
    const found = dict.chinese('边界').map((m) => m.hanzi);
    assert.equal(found[0], 'boundary', found.join(', '));
    assert.ok(found.indexOf('border') < found.indexOf('march'), found.join(', '));
  });
});

describe('EnglishDictionary British and American 音标', () => {
  it('gives both accents in modern IPA', () => {
    const [border] = dict.lookup('border').words;
    assert.equal(border.pinyin, 'ˈbɔːdə');
    assert.equal(border.pinyinUs, 'ˈbɔːrdər');
    const [go] = dict.lookup('go').words;
    assert.equal(go.pinyin, 'ɡəʊ');
    assert.equal(go.pinyinUs, 'ɡoʊ');
  });

  it('builds the American phrase line too', () => {
    assert.equal(dict.lookup('I like coffee').pinyinUs, '/aɪ laɪk ˈkɑːfi/');
  });

  it('gives dictionary matches both accents', () => {
    const border = dict.chinese('边界').find((m) => m.hanzi === 'border');
    assert.equal(border?.pinyinUs, 'ˈbɔːrdər');
  });
});
