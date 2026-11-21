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

/** A Chinese word found by searching the dictionary's English meanings. */
export interface EnglishMatch {
  hanzi: string;
  /** Dictionary reading with tone marks, e.g. "chī". */
  pinyin: string;
  defs: string[];
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
  /** Send looked-up text to online translators. Dictionary, pinyin and speech never leave the Mac. */
  onlineTranslation: boolean;
  /** Nothing is sent online until the first-run notice has been answered. */
  translationNoticeSeen: boolean;
  savedSort: SavedSort;
  /** Opens EN→中: "DoubleControl" (default), another "Double…" modifier, an accelerator, or "Off". */
  translateHotkey: string;
}

export type AppMode = 'card' | 'hidden';

export type SavedSort = 'recent' | 'pinyin' | 'practice';

export type IncomingSource = 'clipboard' | 'hotkey';

export interface HanziApi {
  lookup(text: string): Promise<LookupResult>;
  translate(text: string): Promise<string | null>;
  /** English to Simplified Chinese, online. Null when offline or online translation is off. */
  translateToChinese(text: string): Promise<string | null>;
  /** Chinese words whose dictionary meaning matches the English, offline. */
  searchEnglish(text: string): Promise<EnglishMatch[]>;
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
  /** Tells the main process which tab is showing, so the translate shortcut can toggle. */
  setView(view: string): void;
  /** Esc in an empty EN→中 box: put the window away and return to the previous app. */
  dismissTranslate(): Promise<void>;

  onIncomingText(cb: (text: string, source: IncomingSource) => void): void;
  onNotice(cb: (message: string) => void): void;
  onSettings(cb: (settings: Settings) => void): void;
  /** The translate shortcut was pressed: show EN→中 and focus its text box. */
  onOpenTranslate(cb: () => void): void;
}
