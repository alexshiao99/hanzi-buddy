import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { SavedItem, Settings } from '../shared/types';

/** A JSON file with atomic writes (temp file + rename) so a crash can't corrupt it. */
class JsonFile<T> {
  constructor(
    private readonly file: string,
    private readonly fallback: () => T,
  ) {}

  read(): T {
    if (!existsSync(this.file)) return this.fallback();
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as T;
    } catch {
      // Keep the unreadable file around rather than silently overwriting it.
      renameSync(this.file, `${this.file}.corrupt-${Date.now()}`);
      return this.fallback();
    }
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
  hotkey: 'CommandOrControl+Shift+Y',
  mode: 'card',
};

export class SettingsStore {
  private readonly file: JsonFile<Partial<Settings>>;
  private cache: Settings;

  constructor(dir: string) {
    this.file = new JsonFile(path.join(dir, 'settings.json'), () => ({}));
    this.cache = { ...DEFAULT_SETTINGS, ...this.file.read() };
  }

  get(): Settings {
    return { ...this.cache };
  }

  set(patch: Partial<Settings>): Settings {
    this.cache = { ...this.cache, ...patch };
    this.file.write(this.cache);
    return this.get();
  }
}

export class SavedStore {
  private readonly file: JsonFile<SavedItem[]>;
  private items: SavedItem[];

  constructor(dir: string) {
    this.file = new JsonFile(path.join(dir, 'saved.json'), () => []);
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
