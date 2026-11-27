import type { Lang } from '../shared/types';

/**
 * UI text for both modes, keyed by the language being learned: `zh` is Hanzi Buddy for English
 * speakers (English UI), `en` the mirror for Chinese speakers learning English (Chinese UI).
 * Static text in index.html names its key with data-i18n (text), data-i18n-title,
 * data-i18n-placeholder or data-i18n-aria; everything else goes through t().
 */
const STRINGS = {
  // tabs
  tabLookup: { zh: 'Lookup: pinyin and meanings for Chinese you copy or highlight', en: '查词：复制或选中英文，查看音标和释义' },
  tabTranslate: { zh: 'Translate English → Chinese', en: '翻译：中文 → 英文' },
  tabSaved: { zh: 'Saved words', en: '收藏的单词' },
  tabReview: { zh: 'Review: flashcards of your saved words', en: '复习：用卡片复习收藏的单词' },

  // header
  switchToEn: { zh: 'Learning Chinese. Click to switch to 学英语 (EN→中). It also switches by itself when you copy or highlight English.', en: '' },
  switchToZh: { zh: '', en: '正在学英语。点击切换到 Learning Chinese（中→EN）。复制或选中中文时也会自动切换。' },
  watchOn: { zh: 'Watching clipboard (click to pause)', en: '正在监听剪贴板（点击暂停）' },
  watchOff: { zh: 'Clipboard watching paused (click to resume)', en: '已暂停监听剪贴板（点击继续）' },
  pinOn: { zh: 'Always on top (click to turn off)', en: '窗口置顶（点击取消）' },
  pinOff: { zh: 'Not on top (click to keep on top)', en: '未置顶（点击置顶）' },
  closePopup: { zh: 'Close (Esc)', en: '关闭（Esc）' },
  closeCard: { zh: 'Close: switches to hidden mode (highlight text, press {0})', en: '关闭：切换到隐藏模式（选中文字后按 {0}）' },
  modeToCard: { zh: 'Switch back to the floating card', en: '切换回浮动卡片' },
  modeToHidden: { zh: 'Hidden mode: no window. Highlight text anywhere and press {0} for a popup.', en: '隐藏模式：不显示窗口。在任何地方选中文字，按 {0} 弹出。' },

  // first-run notice
  noticeText: {
    zh: 'Phrase translation sends the text you look up, including text you copy while clipboard watching is on and text you type in Translate, to Google Translate and MyMemory. Pronunciation, word meanings and speech stay on your Mac.',
    en: '整句翻译会把你查询的文字（包括开启剪贴板监听时复制的文字，以及在翻译页输入的文字）发送给 Google 翻译和 MyMemory。音标、单词释义和朗读都只在你的 Mac 上处理。',
  },
  noticeAllow: { zh: 'Use online translation', en: '使用在线翻译' },
  noticeDeny: { zh: 'Stay offline', en: '保持离线' },

  // lookup
  emptyBig: { zh: '复制 · 学习', en: 'Copy · Learn' },
  emptyBefore: { zh: 'Copy any Chinese text, or highlight it and press ', en: '复制任意英文，或选中后按 ' },
  emptyAfter: { zh: '.', en: '。' },
  emptyAuto: { zh: 'English you copy or highlight opens 学英语 mode, for Chinese speakers learning English.', en: '复制或选中中文会切换到 Learning Chinese 模式（给学中文的英语使用者）。' },
  listen: { zh: '🔊 Listen', en: '🔊 英' },
  listenTitle: { zh: 'Read aloud', en: '英式发音（Daniel）' },
  listenUs: { zh: '', en: '🔊 美' },
  listenUsTitle: { zh: '', en: '美式发音（Samantha）' },
  slow: { zh: '🐢 Slow', en: '🐢 慢速' },
  slowTitle: { zh: 'Read aloud slowly', en: '慢速朗读' },
  save: { zh: '☆ Save', en: '☆ 收藏' },
  saved: { zh: '★ Saved', en: '★ 已收藏' },
  saveTitle: { zh: 'Save to your list', en: '加入收藏' },
  copyPron: { zh: 'Copy pinyin', en: '复制音标' },
  copyPronTitle: { zh: 'Copy pinyin', en: '复制音标' },
  pronCopied: { zh: 'Pinyin copied', en: '音标已复制' },
  wordByWord: { zh: 'Word by word', en: '逐词释义' },
  translating: { zh: 'Translating…', en: '翻译中…' },
  phraseUnavailable: { zh: 'Phrase translation unavailable (offline?). Word meanings are below.', en: '整句翻译不可用（没有联网？）。单词释义见下方。' },
  phraseOff: { zh: 'Online translation is off. Word meanings are below.', en: '在线翻译已关闭。单词释义见下方。' },
  notInDictionary: { zh: '(not in dictionary)', en: '（词典中没有）' },
  listenWord: { zh: 'Listen', en: '朗读' },
  saveWord: { zh: 'Save this word', en: '收藏这个词' },
  unsaveWord: { zh: 'Remove from saved', en: '取消收藏' },
  removeConfirm: { zh: 'Remove?', en: '移除？' },
  deleteConfirm: { zh: 'Delete?', en: '删除？' },
  savedToast: { zh: 'Saved {0}', en: '已收藏 {0}' },
  removedToast: { zh: 'Removed {0}', en: '已移除 {0}' },

  // translate tab (type the language you know)
  typePlaceholder: { zh: 'Type English, e.g. happy or I want coffee', en: '输入中文，例如 快乐 或 我想喝咖啡' },
  typeSubmit: { zh: 'Translate', en: '翻译' },
  typeBig: { zh: '英 → 中', en: '中 → 英' },
  typeHint: {
    zh: 'Type an English word or sentence and press Enter. Words also show matches from the offline dictionary as you type.',
    en: '输入中文词语或句子，按回车翻译成英文。输入词语时也会显示离线词典里的英文单词。',
  },
  typeHotkey: { zh: 'Open this tab from anywhere with {0}.', en: '在任何地方按 {0} 打开这一页。' },
  typeOpenTitle: { zh: 'Open in Lookup for pinyin by character and word meanings', en: '在查词页查看每个单词的音标和释义' },
  typeOpen: { zh: 'Word by word →', en: '逐词释义 →' },
  dictionary: { zh: 'Dictionary', en: '词典' },
  typeUnavailable: { zh: 'Translation unavailable (offline?).', en: '翻译不可用（没有联网？）。' },
  typeOff: { zh: 'Online translation is off (turn it on in the 汉 menu).', en: '在线翻译已关闭（在菜单栏 汉 菜单里打开）。' },
  matchesBelow: { zh: ' Dictionary matches are below.', en: '词典结果见下方。' },
  noMatches: { zh: ' No dictionary matches either.', en: '词典里也没有找到。' },
  pressEnter: { zh: 'Press Enter to translate.', en: '按回车翻译。' },
  openInLookup: { zh: 'Open in Lookup', en: '在查词页打开' },

  // saved
  searchPlaceholder: { zh: 'Search saved…', en: '搜索收藏…' },
  sortTitle: { zh: 'Sort saved items', en: '排序' },
  sortRecent: { zh: 'Recent', en: '最近' },
  sortPinyin: { zh: 'Pinyin A–Z', en: '字母 A–Z' },
  sortPractice: { zh: 'Needs practice', en: '需要练习' },
  export: { zh: 'Export', en: '导出' },
  exportTitle: { zh: 'Export as CSV (Anki-importable)', en: '导出为 CSV（可导入 Anki）' },
  exported: { zh: 'Exported to {0}', en: '已导出到 {0}' },
  savedEmpty: { zh: 'Nothing saved yet. Press ☆ Save on a lookup.', en: '还没有收藏。查词时点 ☆ 收藏。' },
  addNote: { zh: 'Add a note', en: '添加笔记' },
  delete: { zh: 'Delete', en: '删除' },
  notePlaceholder: { zh: 'Note (e.g. where you saw it)', en: '笔记（例如在哪里看到的）' },
  missedTimes: { zh: 'missed {0}×', en: '错 {0} 次' },
  Today: { zh: 'Today', en: '今天' },
  'Last 7 days': { zh: 'Last 7 days', en: '最近 7 天' },
  Earlier: { zh: 'Earlier', en: '更早' },
  Missed: { zh: 'Missed', en: '答错过' },
  'Not reviewed yet': { zh: 'Not reviewed yet', en: '还没复习' },
  'No misses': { zh: 'No misses', en: '全部答对' },

  // review
  reviewEmpty: { zh: 'Save a few words first, then review them here.', en: '先收藏几个单词，再来这里复习。' },
  reviewStats: { zh: '{0} saved · {1} reviewed this session', en: '已收藏 {0} 个 · 本次复习 {1} 个' },
  reviewPrompt: { zh: 'tap to reveal', en: '点击显示答案' },
  reviewCardTitle: { zh: 'Click or press Space to reveal', en: '点击或按空格键显示答案' },
  again: { zh: 'Again', en: '再来' },
  gotIt: { zh: 'Got it', en: '记住了' },
} satisfies Record<string, Record<Lang, string>>;

export type StringKey = keyof typeof STRINGS;

export function t(lang: Lang, key: StringKey, ...args: Array<string | number>): string {
  return STRINGS[key][lang].replace(/\{(\d)\}/g, (_, i: string) => String(args[Number(i)] ?? ''));
}

/** Group labels from groupSaved() ('Today', 'Missed', …) or a letter, which stays as it is. */
export function groupLabel(lang: Lang, label: string): string {
  return label in STRINGS ? t(lang, label as StringKey) : label;
}

/** Fills every data-i18n* element on the page for this mode. */
export function translatePage(lang: Lang): void {
  for (const [attr, apply] of [
    ['i18n', (el: HTMLElement, s: string) => (el.textContent = s)],
    ['i18nTitle', (el: HTMLElement, s: string) => (el.title = s)],
    ['i18nPlaceholder', (el: HTMLElement, s: string) => ((el as HTMLInputElement).placeholder = s)],
    ['i18nAria', (el: HTMLElement, s: string) => el.setAttribute('aria-label', s)],
  ] as const) {
    const selector = `[data-${attr.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}]`;
    document.querySelectorAll<HTMLElement>(selector).forEach((el) => apply(el, t(lang, el.dataset[attr] as StringKey)));
  }
  document.documentElement.lang = lang === 'zh' ? 'en' : 'zh-CN';
}
