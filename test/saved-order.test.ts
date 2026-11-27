import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { groupSaved, type SavedGroup } from '../src/shared/saved-order';
import type { SavedItem } from '../src/shared/types';

const now = new Date(2026, 10, 5, 12).getTime();

const item = (hanzi: string, patch: Partial<SavedItem> = {}): SavedItem => ({
  id: hanzi,
  hanzi,
  pinyin: '',
  translation: '',
  note: '',
  addedAt: now,
  reviewCount: 0,
  correct: 0,
  again: 0,
  lastReviewed: null,
  ...patch,
});

const shape = (groups: SavedGroup[]) => groups.map((g) => [g.label, g.items.map((i) => i.hanzi)]);

describe('groupSaved', () => {
  it('groups by calendar day when sorting by recent, newest first', () => {
    const items = [
      item('older', { addedAt: new Date(2026, 9, 29, 23, 59).getTime() }),
      item('sixDaysAgo', { addedAt: new Date(2026, 9, 30, 0, 0).getTime() }),
      item('lastNight', { addedAt: new Date(2026, 10, 4, 23, 59).getTime() }),
      item('thisMorning', { addedAt: new Date(2026, 10, 5, 0, 0).getTime() }),
      item('justNow', { addedAt: now }),
    ];
    assert.deepEqual(shape(groupSaved(items, 'recent', now)), [
      ['Today', ['justNow', 'thisMorning']],
      ['Last 7 days', ['lastNight', 'sixDaysAgo']],
      ['Earlier', ['older']],
    ]);
  });

  it('leaves out empty groups', () => {
    assert.deepEqual(groupSaved([], 'recent', now), []);
    assert.deepEqual(groupSaved([], 'pinyin', now), []);
    assert.deepEqual(groupSaved([], 'practice', now), []);
    assert.deepEqual(shape(groupSaved([item('a')], 'recent', now)), [['Today', ['a']]]);
  });

  it('sorts pinyin by letter, ignoring tone marks, spaces and punctuation', () => {
    const items = [
      item('学习', { pinyin: 'xuéxí' }),
      item('学中文', { pinyin: 'xué zhōngwén' }),
      item('绿', { pinyin: 'lǜ' }),
      item('你好', { pinyin: 'nǐhǎo' }),
      item('“好”', { pinyin: '“hǎo”' }),
      item('喜欢', { pinyin: 'xǐhuan' }),
    ];
    assert.deepEqual(shape(groupSaved(items, 'pinyin', now)), [
      ['H', ['“好”']],
      ['L', ['绿']],
      ['N', ['你好']],
      ['X', ['喜欢', '学习', '学中文']],
    ]);
  });

  it('puts items with no usable pinyin last', () => {
    const items = [item('???', { pinyin: '' }), item('好', { pinyin: 'hǎo' })];
    assert.deepEqual(shape(groupSaved(items, 'pinyin', now)), [
      ['H', ['好']],
      ['#', ['???']],
    ]);
  });

  it('orders practice by most missed, then unreviewed, then no misses', () => {
    const items = [
      item('mastered', { reviewCount: 9, correct: 9 }),
      item('shaky', { reviewCount: 1, correct: 1 }),
      item('missedTwice', { reviewCount: 2, again: 2 }),
      item('recovered', { reviewCount: 24, correct: 20, again: 4 }),
      item('struggling', { reviewCount: 5, correct: 1, again: 4 }),
      item('new'),
    ];
    assert.deepEqual(shape(groupSaved(items, 'practice', now)), [
      ['Missed', ['struggling', 'recovered', 'missedTwice']],
      ['Not reviewed yet', ['new']],
      ['No misses', ['shaky', 'mastered']],
    ]);
  });

  it('does not reorder the list it was given', () => {
    const items = [item('b', { addedAt: 1 }), item('a', { addedAt: 2 })];
    groupSaved(items, 'recent', now);
    assert.deepEqual(items.map((i) => i.hanzi), ['b', 'a']);
  });
});

describe('groupSaved for English words (学英语)', () => {
  it('sorts A–Z by the word, not its 音标', () => {
    const items = [item('zebra', { pinyin: 'ˈziːbrə' }), item('apple', { pinyin: 'ˈæpl' }), item('Happy', { pinyin: 'ˈhæpi' })];
    assert.deepEqual(shape(groupSaved(items, 'pinyin', now, 'en')), [
      ['A', ['apple']],
      ['H', ['Happy']],
      ['Z', ['zebra']],
    ]);
  });
});
