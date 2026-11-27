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
  /** English only: American 音标; `pinyin` holds the British one. */
  pinyinUs?: string;
  /** Dictionary definitions for the reading used in context (empty if unknown or not Chinese). */
  defs: string[];
  isHan: boolean;
}

export interface LookupResult {
  text: string;
  /**
   * Whole-phrase pronunciation: pinyin with words separated by spaces ("wǒ xǐhuan xué zhōngwén"), or
   * for English the 音标 between slashes ("/aɪ laɪk ˈkɒfi/").
   */
  pinyin: string;
  /** English only: the phrase's American 音标 ("/aɪ laɪk ˈkɑːfi/"); `pinyin` holds the British one. */
  pinyinUs?: string;
  /**
   * Chinese words, or for English (lang 'en') English words, where `hanzi` is the word, `pinyin` its
   * 音标, `defs` its Chinese meanings and `isHan` means "is a word".
   */
  words: WordInfo[];
  /** The language of `text`, which is the language being learned. */
  lang: Lang;
}

/**
 * The language being learned, which picks the card's mode. zh: Hanzi Buddy for English speakers
 * (Chinese in, pinyin + English out, English UI). en: the mirror for Chinese speakers (English in,
 * 音标 + Chinese out, Chinese UI).
 */
export type Lang = 'zh' | 'en';

/** zh: the Mandarin voice. en-GB / en-US: British (Daniel) or American (Samantha) English. */
export type Voice = 'zh' | 'en-GB' | 'en-US';

/**
 * A dictionary word found by meaning: a Chinese word for an English query, or (mirror mode) an English
 * word for a Chinese query, where `hanzi` is the English word and `pinyin` its 音标.
 */
export interface EnglishMatch {
  hanzi: string;
  /** English matches only: American 音标; `pinyin` holds the British one. */
  pinyinUs?: string;
  /** Dictionary reading with tone marks, e.g. "chī". */
  pinyin: string;
  defs: string[];
}

/** In the English (mirror) list, `hanzi` is the English word, `pinyin` its 音标 and `translation` Chinese. */
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
  /**
   * The card's mode, set automatically from the last text you copied or highlighted (and by the
   * header switch). zh-en: learning Chinese. en-zh: the mirror, learning English.
   */
  direction: Direction;
}

export type Direction = 'zh-en' | 'en-zh';

export type AppMode = 'card' | 'hidden';

export type SavedSort = 'recent' | 'pinyin' | 'practice';

export type IncomingSource = 'clipboard' | 'hotkey';

export interface HanziApi {
  /** Chinese or English, decided by the text: anything with Chinese characters is a Chinese lookup. */
  lookup(text: string): Promise<LookupResult>;
  /** Chinese to English, online. Null when offline or online translation is off. */
  translate(text: string): Promise<string | null>;
  /** English to Simplified Chinese, online. Null when offline or online translation is off. */
  translateToChinese(text: string): Promise<string | null>;
  /** Chinese words whose dictionary meaning matches the English, offline. */
  searchEnglish(text: string): Promise<EnglishMatch[]>;
  /** English words whose dictionary meaning matches the Chinese, offline (mirror mode). */
  searchChinese(text: string): Promise<EnglishMatch[]>;
  speak(text: string, slow: boolean, voice: Voice): Promise<void>;
  copyText(text: string): Promise<void>;

  /** Each language has its own saved list and review deck. */
  listSaved(lang: Lang): Promise<SavedItem[]>;
  addSaved(lang: Lang, item: Pick<SavedItem, 'hanzi' | 'pinyin' | 'translation'>): Promise<SavedItem>;
  updateSaved(lang: Lang, id: string, patch: Partial<SavedItem>): Promise<SavedItem | null>;
  removeSaved(lang: Lang, id: string): Promise<void>;
  exportCsv(lang: Lang): Promise<string | null>;

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
