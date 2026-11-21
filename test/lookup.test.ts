import assert from 'node:assert/strict';
import path from 'node:path';
import { before, describe, it } from 'node:test';
import { Dictionary, normalizeGloss, numberedToMarks, translate, type FetchLike } from '../src/main/lookup';

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

describe('english search', () => {
  const top = (q: string, n = 3) => dict.english(q).slice(0, n).map((m) => m.hanzi);

  it('normalizes glosses', () => {
    assert.equal(normalizeGloss('to eat'), 'eat');
    assert.equal(normalizeGloss('Apple (fruit)'), 'apple');
    assert.equal(normalizeGloss('  Thank  you! '), 'thank you');
  });

  it('converts dictionary readings to tone marks', () => {
    assert.equal(numberedToMarks('xi3 huan5'), 'xǐhuan');
    assert.equal(numberedToMarks('nu:3 er2'), 'nǚér');
  });

  it('finds everyday words near the top', () => {
    assert.ok(top('eat').includes('吃'));
    assert.ok(top('cat').includes('猫'));
    assert.ok(top('water').includes('水'));
    assert.ok(top('computer').includes('电脑'));
    assert.deepEqual(top('to love', 1), top('love', 1));
  });

  it('puts the common noun before the proper noun', () => {
    const [apple] = dict.english('apple');
    assert.equal(apple.hanzi, '苹果');
    assert.equal(apple.pinyin, 'píngguǒ');
  });

  it('returns nothing for unknown words, empty queries and long sentences', () => {
    assert.deepEqual(dict.english('xyzzyq'), []);
    assert.deepEqual(dict.english('   '), []);
    assert.deepEqual(dict.english('I would like to order a coffee please'), []);
  });
});

describe('translate english to chinese', () => {
  it('asks for en → zh-CN and caches separately from zh → en', async () => {
    const urls: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      urls.push(url);
      return new Response(JSON.stringify([[['你好', 'hello']]]), { headers: { 'content-type': 'application/json' } });
    };
    assert.equal(await translate('hello', fetchImpl, 'en-zh'), '你好');
    assert.ok(urls[0].includes('sl=en&tl=zh-CN'));
    await translate('hello', fetchImpl, 'zh-en');
    assert.equal(urls.length, 2);
    assert.ok(urls[1].includes('sl=zh-CN&tl=en'));
  });

  it('falls back to MyMemory with the right language pair', async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (url.includes('googleapis')) throw new Error('offline');
      assert.ok(url.includes('langpair=en%7Czh-CN'));
      return new Response(JSON.stringify({ responseStatus: 200, responseData: { translatedText: '猫' } }));
    };
    assert.equal(await translate('cat', fetchImpl, 'en-zh'), '猫');
  });
});
