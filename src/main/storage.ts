import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_HOTKEY } from '../shared/hotkey';
import { APP_MODES, SAVED_SORTS, type Bounds, type SavedItem, type Settings } from '../shared/types';

/** A JSON file with atomic writes (temp file + rename) so a crash can't corrupt it. */
class JsonFile<T> {
  constructor(
    private readonly file: string,
    private readonly fallback: () => T,
    private readonly isValid: (value: unknown) => value is T,
  ) {}

  read(): T {
    if (!existsSync(this.file)) return this.fallback();
    try {
      const value: unknown = JSON.parse(readFileSync(this.file, 'utf8'));
      if (this.isValid(value)) return value;
    } catch {
      // handled below, same as parseable JSON of the wrong shape
    }
    // Keep the unreadable file around rather than silently overwriting it.
    renameSync(this.file, `${this.file}.corrupt-${Date.now()}`);
    return this.fallback();
  }

  write(value: T): void {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(value, null, 2));
    renameSync(tmp, this.file);
  }
}

export const DEFAULT_SETTINGS: Settings = {
  bounds: null,
  watchClipboard: true,
  alwaysOnTop: true,
  toneColors: true,
  hotkey: DEFAULT_HOTKEY,
  mode: 'card',
  onlineTranslation: true,
  translationNoticeSeen: false,
  savedSort: 'recent',
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const isBounds = (v: unknown): v is Bounds =>
  isObject(v) && [v.x, v.y, v.width, v.height].every((n) => typeof n === 'number' && Number.isFinite(n));

const BOOLEAN_SETTINGS = ['watchClipboard', 'alwaysOnTop', 'toneColors', 'onlineTranslation', 'translationNoticeSeen'] as const;

const isOneOf = <T extends string>(choices: readonly T[], v: unknown): v is T => choices.includes(v as T);

/** Starts from the defaults so a missing or wrong-typed field in a hand-edited file can't break the app. */
function sanitizeSettings(raw: Record<string, unknown>): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  if (isBounds(raw.bounds)) out.bounds = raw.bounds;
  for (const key of BOOLEAN_SETTINGS) {
    const value = raw[key];
    if (typeof value === 'boolean') out[key] = value;
  }
  if (typeof raw.hotkey === 'string' && raw.hotkey) out.hotkey = raw.hotkey;
  if (isOneOf(APP_MODES, raw.mode)) out.mode = raw.mode;
  if (isOneOf(SAVED_SORTS, raw.savedSort)) out.savedSort = raw.savedSort;
  return out;
}

const isSavedItem = (v: unknown): boolean =>
  isObject(v) &&
  [v.id, v.hanzi, v.pinyin, v.translation, v.note].every((s) => typeof s === 'string') &&
  [v.addedAt, v.reviewCount, v.correct, v.again].every((n) => typeof n === 'number');

const isSavedList = (v: unknown): v is SavedItem[] => Array.isArray(v) && v.every(isSavedItem);

export class SettingsStore {
  private readonly file: JsonFile<Record<string, unknown>>;
  private cache: Settings;

  constructor(dir: string) {
    this.file = new JsonFile(path.join(dir, 'settings.json'), () => ({}), isObject);
    this.cache = sanitizeSettings(this.file.read());
  }

  get(): Settings {
    return { ...this.cache };
  }

  set(patch: Partial<Settings>): Settings {
    this.cache = { ...this.cache, ...patch };
    this.file.write({ ...this.cache });
    return this.get();
  }
}

export class SavedStore {
  private readonly file: JsonFile<SavedItem[]>;
  private items: SavedItem[];

  constructor(dir: string) {
    this.file = new JsonFile(path.join(dir, 'saved.json'), () => [], isSavedList);
    this.items = this.file.read();
  }

  list(): SavedItem[] {
    return [...this.items].sort((a, b) => b.addedAt - a.addedAt);
  }

  /** Adds an item, or returns the existing one if this hanzi is already saved. */
  add(input: Pick<SavedItem, 'hanzi' | 'pinyin' | 'translation'>): SavedItem {
    const existing = this.items.find((i) => i.hanzi === input.hanzi);
    if (existing) return existing;
    const item: SavedItem = {
      id: randomUUID(),
      hanzi: input.hanzi,
      pinyin: input.pinyin,
      translation: input.translation,
      note: '',
      addedAt: Date.now(),
      reviewCount: 0,
      correct: 0,
      again: 0,
      lastReviewed: null,
    };
    this.items.push(item);
    this.file.write(this.items);
    return item;
  }

  update(id: string, patch: Partial<SavedItem>): SavedItem | null {
    const item = this.items.find((i) => i.id === id);
    if (!item) return null;
    Object.assign(item, patch, { id: item.id });
    this.file.write(this.items);
    return item;
  }

  remove(id: string): void {
    this.items = this.items.filter((i) => i.id !== id);
    this.file.write(this.items);
  }

  toCsv(): string {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const rows = this.list().map((i) =>
      [i.hanzi, i.pinyin, i.translation, i.note, new Date(i.addedAt).toISOString().slice(0, 10)].map(esc).join(','),
    );
    return ['hanzi,pinyin,translation,note,added', ...rows].join('\n') + '\n';
  }
}
