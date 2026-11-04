export interface CharInfo {
  char: string;
  /** Pinyin with tone marks, empty for non-Chinese characters. */
  pinyin: string;
  /** 1-4 for tones, 0 for neutral tone or non-Chinese. */
  tone: number;
  isHan: boolean;
}

export interface WordInfo {
  hanzi: string;
  /** Syllables with tone marks joined without spaces, e.g. "xǐhuan". */
  pinyin: string;
  chars: CharInfo[];
  /** Dictionary definitions for the reading used in context (empty if unknown or not Chinese). */
  defs: string[];
  isHan: boolean;
}

export interface LookupResult {
  text: string;
  /** Whole-phrase pinyin, words separated by spaces: "wǒ xǐhuan xué zhōngwén". */
  pinyin: string;
  words: WordInfo[];
}

export interface SavedItem {
  id: string;
  hanzi: string;
  pinyin: string;
  translation: string;
  note: string;
  addedAt: number;
  reviewCount: number;
  correct: number;
  again: number;
  lastReviewed: number | null;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Settings {
  bounds: Bounds | null;
  watchClipboard: boolean;
  alwaysOnTop: boolean;
  toneColors: boolean;
  hotkey: string;
  /**
   * card: floating card that stays visible and follows the clipboard.
   * hidden: no window; highlighted Chinese is watched and the hotkey opens a popup at the cursor.
   */
  mode: AppMode;
}

export type AppMode = 'card' | 'hidden';

export type IncomingSource = 'clipboard' | 'hotkey';

export interface HanziApi {
  lookup(text: string): Promise<LookupResult>;
  translate(text: string): Promise<string | null>;
  speak(text: string, slow: boolean): Promise<void>;
  copyText(text: string): Promise<void>;

  listSaved(): Promise<SavedItem[]>;
  addSaved(item: Pick<SavedItem, 'hanzi' | 'pinyin' | 'translation'>): Promise<SavedItem>;
  updateSaved(id: string, patch: Partial<SavedItem>): Promise<SavedItem | null>;
  removeSaved(id: string): Promise<void>;
  exportCsv(): Promise<string | null>;

  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  hideWindow(): Promise<void>;

  onIncomingText(cb: (text: string, source: IncomingSource) => void): void;
  onNotice(cb: (message: string) => void): void;
  onSettings(cb: (settings: Settings) => void): void;
}
