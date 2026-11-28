import assert from 'node:assert/strict';
import path from 'node:path';
import { before, describe, it } from 'node:test';
import { Dictionary, translate, type FetchLike } from '../src/main/lookup';

let dict: Dictionary;
before(() => {
  dict = new Dictionary(path.join(process.cwd(), 'data', 'cedict.txt'));
});

const words = (text: string) => dict.lookup(text).words.map((w) => w.hanzi);

describe('segmentation', () => {
  it('prefers even splits over the longest first word', () => {
    assert.deepEqual(words('研究生命'), ['研究', '生命']);
    assert.deepEqual(words('南京市长江大桥'), ['南京市', '长江', '大桥']);
  });

  it('keeps long words whole when they give fewer words', () => {
    assert.deepEqual(words('研究生很忙'), ['研究生', '很', '忙']);
    assert.deepEqual(words('中华人民共和国'), ['中华人民共和国']);
  });

  it('keeps non-Chinese runs together and splits around them', () => {
    assert.deepEqual(words('iPhone手机很好'), ['iPhone', '手机', '很', '好']);
    assert.deepEqual(words('价格100元'), ['价格', '100', '元']);
  });

  it('falls back to single characters with an empty dictionary', () => {
    assert.deepEqual(new Dictionary().lookup('你好').words.map((w) => w.hanzi), ['你', '好']);
  });
});

describe('definitions', () => {
  it('matches dictionary readings despite spoken tone changes', () => {
    const [word] = dict.lookup('不是').words;
    assert.equal(word.pinyin, 'búshì'); // still displayed as spoken
    assert.ok(word.defs.includes('is not'));
    assert.ok(!word.defs.includes('fault; blame'));
  });

  it('uses context for polyphonic characters', () => {
    assert.equal(dict.lookup('银行').pinyin, 'yínháng');
    assert.equal(dict.lookup('行走').pinyin, 'xíngzǒu');
  });
});

describe('pinyin', () => {
  it('stays aligned across mixed text and emoji', () => {
    const han = dict.lookup('😀Hello你好100吗').words.flatMap((w) => w.chars).filter((c) => c.isHan);
    assert.deepEqual(han.map((c) => `${c.char}${c.pinyin}`), ['你nǐ', '好hǎo', '吗ma']);
  });

  it('attaches punctuation to the preceding word', () => {
    assert.equal(dict.lookup('你好，世界').pinyin, 'nǐhǎo, shìjiè');
  });

  it('attaches opening quotes and brackets to the following word', () => {
    const empty = new Dictionary();
    assert.equal(empty.lookup('他说“你好”。').pinyin, 'tā shuō "nǐ hǎo".');
    assert.equal(empty.lookup('我（很）好').pinyin, 'wǒ (hěn) hǎo');
    assert.equal(empty.lookup('他说"你好"。').pinyin, 'tā shuō "nǐ hǎo".');
  });

  it('keeps characters with no known pinyin visible', () => {
    assert.ok(dict.lookup('𠮷野').pinyin.startsWith('𠮷'));
  });
});

describe('translate', () => {
  const googleOk = (text: string) =>
    new Response(JSON.stringify([[[text, 'source']]]), { headers: { 'content-type': 'application/json' } });
  const myMemoryOk = (text: string) =>
    new Response(JSON.stringify({ responseStatus: 200, responseData: { translatedText: text } }));
  const isGoogle = (url: string) => url.includes('googleapis');

  it('does not call the fallback when the primary answers quickly', async () => {
    const calls: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      calls.push(url);
      return googleOk('from google');
    };
    assert.equal(await translate('测试一', fetchImpl), 'from google');
    assert.equal(calls.length, 1);
  });

  it('falls back when the primary fails', async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (isGoogle(url)) throw new Error('offline');
      return myMemoryOk('from mymemory');
    };
    assert.equal(await translate('测试二', fetchImpl), 'from mymemory');
  });

  it('asks the fallback when the primary is slow', async () => {
    const fetchImpl: FetchLike = (url) =>
      isGoogle(url) ? new Promise(() => {}) : Promise.resolve(myMemoryOk('from mymemory'));
    assert.equal(await translate('测试三', fetchImpl), 'from mymemory');
  });

  it('returns null when both fail, and does not cache the failure', async () => {
    const failing: FetchLike = async () => {
      throw new Error('offline');
    };
    assert.equal(await translate('测试四', failing), null);
    assert.equal(await translate('测试四', async () => googleOk('recovered')), 'recovered');
  });

  it('serves repeat lookups from the cache', async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async () => {
      calls++;
      return googleOk('cached');
    };
    await translate('测试五', fetchImpl);
    assert.equal(await translate('测试五', fetchImpl), 'cached');
    assert.equal(calls, 1);
  });
});
