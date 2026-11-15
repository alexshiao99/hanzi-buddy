import type { SavedItem, SavedSort } from './types';

export interface SavedGroup {
  label: string;
  items: SavedItem[];
}

/** Strip tone marks so "xihuan" matches "xǐhuan". */
export const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const newestFirst = (a: SavedItem, b: SavedItem) => b.addedAt - a.addedAt;

/** Letters only, so spaces and punctuation in a phrase's pinyin don't affect where it sorts. */
const pinyinKey = (i: SavedItem) => plain(i.pinyin).replace(/[^a-z]/g, '');

function groupsInOrder(items: SavedItem[], labelFor: (i: SavedItem) => string): SavedGroup[] {
  const groups = new Map<string, SavedItem[]>();
  for (const item of items) {
    const label = labelFor(item);
    const group = groups.get(label);
    if (group) group.push(item);
    else groups.set(label, [item]);
  }
  return Array.from(groups, ([label, grouped]) => ({ label, items: grouped }));
}

function byRecent(items: SavedItem[], now: number): SavedGroup[] {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const startOfToday = today.getTime();
  const startOfWeek = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6).getTime();
  return groupsInOrder([...items].sort(newestFirst), (i) =>
    i.addedAt >= startOfToday ? 'Today' : i.addedAt >= startOfWeek ? 'Last 7 days' : 'Earlier',
  );
}

function byPinyin(items: SavedItem[]): SavedGroup[] {
  const sorted = [...items].sort((a, b) => {
    const [ka, kb] = [pinyinKey(a), pinyinKey(b)];
    if (!ka !== !kb) return ka ? -1 : 1; // no pinyin goes last
    if (ka !== kb) return ka < kb ? -1 : 1;
    return a.pinyin.localeCompare(b.pinyin) || a.hanzi.localeCompare(b.hanzi);
  });
  return groupsInOrder(sorted, (i) => pinyinKey(i)[0]?.toUpperCase() ?? '#');
}

function byPractice(items: SavedItem[]): SavedGroup[] {
  const missed = items
    .filter((i) => i.again > 0)
    .sort((a, b) => b.again - a.again || a.correct - b.correct || newestFirst(a, b));
  const unreviewed = items.filter((i) => i.again === 0 && i.reviewCount === 0).sort(newestFirst);
  const noMisses = items
    .filter((i) => i.again === 0 && i.reviewCount > 0)
    .sort((a, b) => a.correct - b.correct || newestFirst(a, b));
  return [
    { label: 'Missed', items: missed },
    { label: 'Not reviewed yet', items: unreviewed },
    { label: 'No misses', items: noMisses },
  ].filter((g) => g.items.length > 0);
}

/** Sorts items and splits them into labelled sections, leaving out any empty ones. */
export function groupSaved(items: SavedItem[], sort: SavedSort, now: number): SavedGroup[] {
  if (sort === 'pinyin') return byPinyin(items);
  if (sort === 'practice') return byPractice(items);
  return byRecent(items, now);
}
