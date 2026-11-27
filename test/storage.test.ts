import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import { DEFAULT_SETTINGS, SavedStore, SettingsStore } from '../src/main/storage';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'hanzi-buddy-test-'));
});

const corruptFiles = () => readdirSync(dir).filter((f) => f.includes('.corrupt-'));
const word = { hanzi: '你好', pinyin: 'nǐhǎo', translation: 'hello' };

describe('SavedStore', () => {
  for (const [name, content] of [
    ['invalid JSON', '{oops'],
    ['JSON that is not a list', '{"a":1}'],
    ['a list with a malformed item', '[{"hanzi":"你好"}]'],
  ]) {
    it(`sets aside ${name} and starts empty`, () => {
      writeFileSync(path.join(dir, 'saved.json'), content);
      assert.deepEqual(new SavedStore(dir).list(), []);
      assert.equal(corruptFiles().length, 1);
    });
  }

  it('persists items and reloads them', () => {
    const added = new SavedStore(dir).add(word);
    assert.deepEqual(new SavedStore(dir).list(), [added]);
    assert.equal(corruptFiles().length, 0);
  });

  it('returns the existing item for a duplicate', () => {
    const store = new SavedStore(dir);
    const first = store.add(word);
    assert.equal(store.add({ ...word, translation: 'other' }).id, first.id);
    assert.equal(store.list().length, 1);
  });

  it('never lets an update change the id', () => {
    const store = new SavedStore(dir);
    const { id } = store.add(word);
    assert.equal(store.update(id, { id: 'other', note: 'n' })?.id, id);
  });

  it('escapes quotes in the CSV export', () => {
    const store = new SavedStore(dir);
    store.add({ ...word, translation: 'say "hi", friend' });
    assert.ok(store.toCsv().includes('"say ""hi"", friend"'));
  });
});

describe('SettingsStore', () => {
  it('starts with online translation waiting on the notice', () => {
    const s = new SettingsStore(dir).get();
    assert.equal(s.translationNoticeSeen, false);
    assert.deepEqual(s, DEFAULT_SETTINGS);
  });

  it('replaces wrong-typed fields with defaults and keeps valid ones', () => {
    writeFileSync(
      path.join(dir, 'settings.json'),
      JSON.stringify({ mode: 'nonsense', hotkey: 5, bounds: { x: 'a' }, toneColors: false, unknown: 1 }),
    );
    assert.deepEqual(new SettingsStore(dir).get(), { ...DEFAULT_SETTINGS, toneColors: false });
  });

  it('sets aside a settings file that is not an object', () => {
    writeFileSync(path.join(dir, 'settings.json'), '[]');
    assert.deepEqual(new SettingsStore(dir).get(), DEFAULT_SETTINGS);
    assert.equal(corruptFiles().length, 1);
  });

  it('writes changes to disk', () => {
    new SettingsStore(dir).set({ onlineTranslation: false, translationNoticeSeen: true });
    assert.equal(JSON.parse(readFileSync(path.join(dir, 'settings.json'), 'utf8')).onlineTranslation, false);
    assert.equal(new SettingsStore(dir).get().onlineTranslation, false);
  });
});

describe('SettingsStore direction', () => {
  it('defaults to 中→EN and keeps a valid choice', () => {
    assert.equal(new SettingsStore(dir).get().direction, 'zh-en');
    new SettingsStore(dir).set({ direction: 'en-zh' });
    assert.equal(new SettingsStore(dir).get().direction, 'en-zh');
  });

  it('ignores an unknown direction', () => {
    writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ direction: 'fr-zh' }));
    assert.equal(new SettingsStore(dir).get().direction, DEFAULT_SETTINGS.direction);
  });
});

describe('SavedStore per language', () => {
  it('keeps English words in their own file, apart from the Chinese list', () => {
    new SavedStore(dir, 'en').add({ hanzi: 'happy', pinyin: 'ˈhæpi', translation: 'a. 快乐的' });
    assert.equal(new SavedStore(dir, 'zh').list().length, 0);
    assert.deepEqual(new SavedStore(dir, 'en').list().map((i) => i.hanzi), ['happy']);
    assert.ok(readdirSync(dir).includes('saved-en.json'));
  });

  it('labels English CSV columns for Chinese speakers', () => {
    const store = new SavedStore(dir, 'en');
    store.add({ hanzi: 'happy', pinyin: 'ˈhæpi', translation: '快乐的' });
    assert.match(store.toCsv(), /^word,phonetic,chinese,note,added\n"happy","ˈhæpi","快乐的",""/);
  });
});
