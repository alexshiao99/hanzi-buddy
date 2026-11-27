import { hotkeyLabel, translateHotkeyLabel } from '../shared/hotkey';
import { groupSaved, plain } from '../shared/saved-order';
import type { EnglishMatch, HanziApi, Lang, LookupResult, SavedItem, SavedSort, Settings, Voice, WordInfo } from '../shared/types';
import { groupLabel, t as translateString, translatePage, type StringKey } from './i18n';

declare global {
  interface Window {
    hanzi: HanziApi;
  }
}

const api = window.hanzi;

// ---- tiny DOM helpers ---------------------------------------------------------------------------

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { className?: string; text?: string; title?: string; onClick?: () => void } = {},
  ...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.title) node.title = props.title;
  if (props.onClick) node.addEventListener('click', props.onClick);
  node.append(...children);
  return node;
}

let toastTimer: number | undefined;
function toast(message: string): void {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), 4000);
}

/**
 * Two-step confirmation for destructive buttons. The first click arms the button and returns false;
 * a second click within 3s returns true. `restore` puts the button back if it times out.
 */
const armedButtons = new WeakMap<HTMLElement, number>();
function disarm(button: HTMLElement): void {
  clearTimeout(armedButtons.get(button));
  armedButtons.delete(button);
  button.classList.remove('confirm');
}

function confirmClick(button: HTMLElement, restore: () => void, label: string): boolean {
  if (armedButtons.has(button)) {
    disarm(button);
    return true;
  }
  button.classList.add('confirm');
  button.textContent = label;
  armedButtons.set(
    button,
    window.setTimeout(() => {
      armedButtons.delete(button);
      button.classList.remove('confirm');
      restore();
    }, 3000),
  );
  return false;
}

// ---- state --------------------------------------------------------------------------------------

type View = 'lookup' | 'translate' | 'saved' | 'review';
const VIEWS: View[] = ['lookup', 'translate', 'saved', 'review'];
const HAN = /\p{Script=Han}/u;

/**
 * The language being learned, which is the card's mode. zh: Hanzi Buddy (Chinese in, pinyin and
 * English out, English UI). en: the mirror for Chinese speakers (English in, 音标 and Chinese out,
 * Chinese UI). Copying or highlighting text switches it to that text's language.
 */
let lang: Lang = 'zh';
const langOf = (text: string): Lang => (HAN.test(text) ? 'zh' : 'en');
const t = (key: StringKey, ...args: Array<string | number>) => translateString(lang, key, ...args);

interface Current {
  result: LookupResult;
  translation: string | null;
  translating: boolean;
}

let settings: Settings;
/** Each mode keeps its own last lookup, so switching back shows what was there. */
const lookups: Record<Lang, Current | null> = { zh: null, en: null };
let current: Current | null = null;
let savedItems: SavedItem[] = [];
let lookupSeq = 0;

const savedByHanzi = (hanzi: string) => savedItems.find((i) => i.hanzi === hanzi);

async function refreshSaved(): Promise<void> {
  const forLang = lang;
  const items = await api.listSaved(forLang);
  if (forLang !== lang) return; // the mode changed while loading
  savedItems = items;
  $('saved-count').textContent = savedItems.length ? String(savedItems.length) : '';
  renderResult();
  renderTranslate();
  if (!$('view-saved').hidden) renderSaved();
  if (!$('view-review').hidden && !reviewItem) startReview();
}

let currentView: View = 'lookup';
function switchView(view: View): void {
  currentView = view;
  for (const v of VIEWS) $(`view-${v}`).hidden = v !== view;
  api.setView(view);
  document.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === view);
  });
  if (view === 'saved') renderSaved();
  if (view === 'review') startReview();
  if (view === 'translate') $<HTMLInputElement>('en-input').focus();
}

const canTranslate = (s: Settings | undefined) => !!s && s.onlineTranslation && s.translationNoticeSeen;

/** Shows the other mode: its UI language, its last lookup, its typing state and its saved list. */
function applyLang(next: Lang): void {
  lang = next;
  document.body.classList.toggle('learn-en', lang === 'en');
  translatePage(lang);
  current = lookups[lang];
  typed = typedByLang[lang];
  $<HTMLInputElement>('en-input').value = typed.input;
  reviewItem = null;
  savedItems = [];
  renderResult();
  renderTranslate();
  if (currentView === 'review') startReview();
  void refreshSaved();
}

function applySettings(s: Settings): void {
  const couldTranslate = canTranslate(settings);
  const previousSort = settings?.savedSort;
  settings = s;
  const nextLang: Lang = s.direction === 'en-zh' ? 'en' : 'zh';
  if (nextLang !== lang || !document.documentElement.dataset.ready) {
    document.documentElement.dataset.ready = '1';
    applyLang(nextLang);
  }
  $<HTMLSelectElement>('saved-sort').value = s.savedSort;
  if (s.savedSort !== previousSort && !$('view-saved').hidden) renderSaved();
  $('translation-notice').hidden = s.translationNoticeSeen;
  const label = hotkeyLabel(s.hotkey);
  $('en-hotkey-hint').textContent = s.translateHotkey === 'Off' ? '' : t('typeHotkey', translateHotkeyLabel(s.translateHotkey));
  $('hotkey-hint').replaceChildren(...Array.from(label, (key) => h('kbd', { text: key })));
  document.body.classList.toggle('tones', s.toneColors);

  const direction = $('btn-direction');
  direction.textContent = lang === 'en' ? 'EN→中' : '中→EN';
  direction.classList.toggle('flipped', lang === 'en');
  direction.title = lang === 'en' ? t('switchToZh') : t('switchToEn');

  const watch = $('btn-watch');
  watch.classList.toggle('on', s.watchClipboard);
  watch.textContent = s.watchClipboard ? '●' : '○';
  watch.title = s.watchClipboard ? t('watchOn') : t('watchOff');
  const pin = $('btn-pin');
  pin.classList.toggle('on', s.alwaysOnTop);
  pin.title = s.alwaysOnTop ? t('pinOn') : t('pinOff');

  const popup = s.mode === 'hidden';
  document.body.classList.toggle('popup', popup);
  $('btn-close').title = popup ? t('closePopup') : t('closeCard', label);
  const mode = $('btn-mode');
  mode.textContent = popup ? '▣' : '◌';
  mode.title = popup ? t('modeToCard') : t('modeToHidden', label);

  if (current) {
    if (!couldTranslate && canTranslate(s)) void runTranslation(current, lookupSeq);
    else renderResult(); // the "translation off" message depends on these settings
  }
  renderTranslate();
}

/** Switches mode and remembers it, so the card opens in the same mode next time. */
async function setLang(next: Lang): Promise<void> {
  if (next === lang) return;
  applyLang(next);
  applySettings(await api.setSettings({ direction: next === 'en' ? 'en-zh' : 'zh-en' }));
}

// ---- speech -------------------------------------------------------------------------------------

/** English is read in the accent last picked with 🔊 英 / 🔊 美; it's remembered on this Mac. */
let accent: Voice = localStorage.getItem('accent') === 'en-US' ? 'en-US' : 'en-GB';

function say(text: string, slow = false, voice?: Voice): void {
  if (voice && voice !== 'zh' && voice !== accent) {
    accent = voice;
    localStorage.setItem('accent', voice);
    renderResult(); // the 音标 above the words follows the accent
  }
  void api.speak(text, slow, voice ?? (langOf(text) === 'zh' ? 'zh' : accent));
}

/**
 * English 音标 in both accents: "英 /ˈbɔːdə/  美 /ˈbɔːrdər/", or once when they're the same or only one
 * is known. Takes bare 音标 or a phrase line already in slashes.
 */
function pronText(uk: string, us = ''): string {
  const wrap = (s: string) => (!s ? '' : s.startsWith('/') ? s : `/${s}/`);
  const [a, b] = [wrap(uk), wrap(us)];
  if (!a || !b || a === b) return a || b;
  return `英 ${a}  美 ${b}`;
}

/** A whole phrase in both accents, one per line (they wrap into each other otherwise). */
function phrasePron(uk: string, us = ''): string {
  const both = pronText(uk, us);
  return both.startsWith('英 ') ? both.replace('  美 ', '\n美 ') : both;
}

/** The 音标 for the accent last picked, falling back to the other one. */
const pickAccent = (uk: string, us = '') => (accent === 'en-US' ? us || uk : uk || us);

// ---- lookup view --------------------------------------------------------------------------------

async function showLookup(text: string): Promise<void> {
  await setLang(langOf(text));
  const seq = ++lookupSeq;
  switchView('lookup');
  const result = await api.lookup(text);
  if (seq !== lookupSeq) return;
  const entry: Current = { result, translation: null, translating: true };
  lookups[result.lang] = entry;
  if (result.lang !== lang) return;
  current = entry;
  renderResult();
  $('words').toggleAttribute('open', result.words.filter((w) => w.isHan).length <= 3);
  document.querySelector('main')?.scrollTo(0, 0);
  await runTranslation(entry, seq);
}

/** The phrase in the other language: English for Chinese, Chinese for English. */
const translateOut = (result: LookupResult) =>
  result.lang === 'zh' ? api.translate(result.text) : api.translateToChinese(result.text);

async function runTranslation(entry: Current, seq: number): Promise<void> {
  entry.translating = true;
  if (entry === current) renderResult();
  const translation = await translateOut(entry.result);
  entry.translation = translation;
  entry.translating = false;
  // Runs even if another lookup has started, since this phrase may have been saved in the meantime.
  if (translation) await replaceSavedGloss(entry.result, translation);
  if (seq !== lookupSeq || entry !== current) return;
  if (!translation) $('words').setAttribute('open', '');
  renderResult();
}

/** Upgrades a saved phrase that only has the dictionary fallback once its real translation is known. */
async function replaceSavedGloss(result: LookupResult, translation: string): Promise<void> {
  if (result.lang !== lang) return;
  const item = savedByHanzi(result.text);
  if (!item || item.translation === translation || item.translation !== dictionaryGloss(result)) return;
  await api.updateSaved(lang, item.id, { translation });
  await refreshSaved();
}

/** Pronunciation above each character (pinyin) or each English word (音标). */
function rubyFor(word: WordInfo): HTMLElement {
  const span = h('span', { className: 'word', title: word.defs[0] ?? '' });
  if (!word.isHan) {
    span.className = '';
    span.textContent = word.hanzi;
    return span;
  }
  for (const c of word.chars) {
    if (!c.isHan) {
      span.append(c.char);
      continue;
    }
    const english = current?.result.lang === 'en';
    const pron = english ? pickAccent(c.pinyin, word.pinyinUs) : c.pinyin;
    span.append(h('ruby', { className: english ? 'en-word' : `t${c.tone}` }, c.char, h('rt', { text: pron })));
  }
  span.addEventListener('click', () => say(word.hanzi));
  return span;
}

const dictionaryGloss = (result: LookupResult) =>
  result.words
    .filter((w) => w.isHan && w.defs.length)
    .map((w) => w.defs[0])
    .join(' · ');

/** English sizes run on letters, not characters, so the thresholds are wider. */
function sizeClass(text: string, textLang: Lang): string {
  const len = Array.from(text).length;
  const [medium, long] = textLang === 'zh' ? [8, 24] : [20, 60];
  return `hanzi ${textLang === 'en' ? 'en ' : ''}${len > long ? 'long' : len > medium ? 'medium' : ''}`;
}

function renderResult(): void {
  $('empty').hidden = !!current;
  $('result').hidden = !current;
  if (!current) return;
  const { result, translation, translating } = current;

  const hanzi = $('hanzi');
  hanzi.className = sizeClass(result.text, result.lang);
  hanzi.replaceChildren(...result.words.map(rubyFor));
  $('pinyin-line').textContent = result.lang === 'en' ? phrasePron(result.pinyin, result.pinyinUs) : result.pinyin;

  const tr = $('translation');
  tr.className = 'translation';
  if (translating) {
    tr.textContent = t('translating');
    tr.classList.add('pending');
  } else if (translation) {
    tr.textContent = translation;
  } else {
    tr.textContent = canTranslate(settings) ? t('phraseUnavailable') : t('phraseOff');
    tr.classList.add('missing');
  }

  const isSaved = !!savedByHanzi(result.text);
  const saveBtn = $('btn-save');
  disarm(saveBtn);
  saveBtn.textContent = isSaved ? t('saved') : t('save');
  saveBtn.classList.toggle('saved', isSaved);

  const words = result.words.filter((w) => w.isHan);
  $('words').hidden = words.length === 0;
  $('word-list').replaceChildren(...words.map(wordRow));
}

function starButton(hanzi: string, pinyin: string, translation: string): HTMLButtonElement {
  const saved = savedByHanzi(hanzi);
  const starText = saved ? '★' : '☆';
  const star: HTMLButtonElement = h('button', {
    text: starText,
    className: saved ? 'saved' : '',
    title: saved ? t('unsaveWord') : t('saveWord'),
    onClick: () => void toggleSave(star, () => (star.textContent = starText), hanzi, pinyin, translation),
  });
  return star;
}

function entryRow(word: string, pron: string, meaning: string, onWord: () => void, wordTitle: string, star: HTMLButtonElement): HTMLLIElement {
  return h(
    'li',
    {},
    h('div', { className: `entry-hanzi${langOf(word) === 'en' ? ' en' : ''}`, text: word, title: wordTitle, onClick: onWord }),
    h(
      'div',
      { className: 'entry-body' },
      h('div', { className: 'entry-pinyin', text: pron }),
      h('div', { className: 'entry-defs', text: meaning }),
    ),
    h('div', { className: 'entry-actions' }, h('button', { text: '🔊', title: t('listenWord'), onClick: () => say(word) }), star),
  );
}

function wordRow(word: WordInfo): HTMLLIElement {
  const meaning = word.defs.slice(0, 4).join(lang === 'zh' ? '; ' : ' · ');
  const star = starButton(word.hanzi, lang === 'en' ? pronText(word.pinyin, word.pinyinUs) : word.pinyin, word.defs.slice(0, 3).join(lang === 'zh' ? '; ' : ' · '));
  const pron = lang === 'en' ? pronText(word.pinyin, word.pinyinUs) : word.pinyin;
  return entryRow(word.hanzi, pron, meaning || t('notInDictionary'), () => say(word.hanzi), t('listenWord'), star);
}

/** Saving is one click. Removing also loses the note and review history, so it asks first. */
async function toggleSave(button: HTMLElement, restore: () => void, hanzi: string, pinyin: string, translation: string): Promise<void> {
  const existing = savedByHanzi(hanzi);
  if (existing) {
    if (!confirmClick(button, restore, t('removeConfirm'))) return;
    await api.removeSaved(lang, existing.id);
    toast(t('removedToast', hanzi));
  } else {
    await api.addSaved(lang, { hanzi, pinyin, translation });
    toast(t('savedToast', hanzi));
  }
  await refreshSaved();
}

// ---- translate view: type the language you know -------------------------------------------------
// Learning Chinese: type English, get Chinese. Learning English (mirror): type Chinese, get English.

interface TypeState {
  input: string;
  /** Online answer in the language being learned, and its pronunciation; null while pending or unavailable. */
  output: string | null;
  pron: string;
  translating: boolean;
  submitted: boolean;
  matches: EnglishMatch[];
}

const emptyTyped = (): TypeState => ({ input: '', output: null, pron: '', translating: false, submitted: false, matches: [] });
const typedByLang: Record<Lang, TypeState> = { zh: emptyTyped(), en: emptyTyped() };
let typed: TypeState = typedByLang.zh;
let typeSeq = 0;
let typeTimer: number | undefined;

const setTyped = (forLang: Lang, state: TypeState) => {
  typedByLang[forLang] = state;
  if (forLang === lang) typed = state;
};

/** Text in the language being learned belongs on the Lookup card, not here. */
const isLearnedLanguage = (text: string) => langOf(text) === lang;
const searchMatches = (text: string) => (lang === 'zh' ? api.searchEnglish(text) : api.searchChinese(text));

/** Dictionary matches update as you type; nothing is sent online until Enter. */
function onTypeInput(): void {
  clearTimeout(typeTimer);
  const text = $<HTMLInputElement>('en-input').value.trim();
  const forLang = lang;
  typeTimer = window.setTimeout(async () => {
    const seq = ++typeSeq;
    const matches = text && !isLearnedLanguage(text) ? await searchMatches(text) : [];
    if (seq !== typeSeq) return;
    setTyped(forLang, { ...emptyTyped(), input: text, matches });
    renderTranslate();
  }, 200);
}

async function submitTyped(): Promise<void> {
  clearTimeout(typeTimer);
  const text = $<HTMLInputElement>('en-input').value.trim();
  if (!text) return;
  if (isLearnedLanguage(text)) return void showLookup(text);
  const seq = ++typeSeq;
  const forLang = lang;
  const online = canTranslate(settings);
  setTyped(forLang, { ...typed, input: text, output: null, pron: '', translating: online, submitted: true });
  renderTranslate();
  const [matches, output] = await Promise.all([
    searchMatches(text),
    online ? (forLang === 'zh' ? api.translateToChinese(text) : api.translate(text)) : null,
  ]);
  // Google sometimes answers a sentence in lower case ("i want to drink…"); a learner should see
  // "I want to drink…". Single words stay as they are (boundary, not Boundary).
  const sentence = (s: string) => s.replace(/^[a-z]/, (c) => c.toUpperCase()).replace(/\bi\b/g, 'I');
  let answer = output && forLang === 'en' && /\s/.test(output.trim()) ? sentence(output) : output;
  let pron = '';
  if (answer) {
    const output = answer;
    const looked = await api.lookup(output);
    pron = looked.lang === 'en' ? pronText(looked.pinyin, looked.pinyinUs) : looked.pinyin;
    // Google's free endpoint sometimes answers a single word misspelled (快乐 → "hapiness"). A learner
    // is better served by the dictionary's top match than by a word the dictionary doesn't know.
    const words = looked.words.filter((w) => w.isHan);
    if (forLang === 'en' && words.length === 1 && !words[0].defs.length && matches[0]) {
      answer = matches[0].hanzi;
      pron = pronText(matches[0].pinyin, matches[0].pinyinUs);
    }
  }
  if (seq !== typeSeq) return;
  setTyped(forLang, { input: text, output: answer, pron, translating: false, submitted: true, matches });
  renderTranslate();
}

function renderTranslate(): void {
  const { output, pron, translating, submitted, matches, input } = typed;
  $('en-empty').hidden = !!input;
  $('en-result').hidden = !output;
  if (output) {
    $('en-hanzi').textContent = output;
    $('en-hanzi').className = sizeClass(output, langOf(output));
    $('en-pinyin').textContent = pron;
    const isSaved = !!savedByHanzi(output);
    const saveBtn = $('btn-en-save');
    disarm(saveBtn);
    saveBtn.textContent = isSaved ? t('saved') : t('save');
    saveBtn.classList.toggle('saved', isSaved);
  }

  let message = '';
  if (translating) message = t('translating');
  else if (submitted && !output) {
    message = canTranslate(settings) ? t('typeUnavailable') : t('typeOff');
    message += matches.length ? t('matchesBelow') : t('noMatches');
  } else if (input && !submitted && !matches.length) message = t('pressEnter');
  const status = $('en-status');
  status.className = translating ? 'translation pending' : 'translation missing';
  status.textContent = message;
  status.hidden = !message;

  $('en-dict').hidden = matches.length === 0;
  $('en-list').replaceChildren(...matches.map(matchRow));
}

function matchRow(match: EnglishMatch): HTMLLIElement {
  const meaning = match.defs.join(lang === 'zh' ? '; ' : ' · ');
  const pron = lang === 'en' ? pronText(match.pinyin, match.pinyinUs) : match.pinyin;
  const star = starButton(match.hanzi, pron, match.defs.slice(0, 3).join(lang === 'zh' ? '; ' : ' · '));
  return entryRow(match.hanzi, pron, meaning, () => void showLookup(match.hanzi), t('openInLookup'), star);
}

// ---- saved view ---------------------------------------------------------------------------------

function renderSaved(): void {
  const q = plain($<HTMLInputElement>('search').value.trim());
  const items = savedItems.filter((i) => !q || [i.hanzi, i.pinyin, i.translation, i.note].some((f) => plain(f).includes(q)));
  $('saved-empty').hidden = savedItems.length > 0;
  $('saved-list').replaceChildren(
    ...groupSaved(items, settings.savedSort, Date.now(), lang).flatMap((group) => [
      h('li', { className: 'saved-group', text: groupLabel(lang, group.label) }),
      ...group.items.map(savedRow),
    ]),
  );
}

function savedRow(item: SavedItem): HTMLLIElement {
  const note = h('div', { className: 'entry-note', text: item.note });
  const del = h('button', { text: '🗑', title: t('delete') });
  del.addEventListener('click', async () => {
    if (!confirmClick(del, () => (del.textContent = '🗑'), t('deleteConfirm'))) return;
    await api.removeSaved(lang, item.id);
    await refreshSaved();
  });

  return h(
    'li',
    {},
    h('div', {
      className: `entry-hanzi${lang === 'en' ? ' en' : ''}`,
      text: item.hanzi,
      title: t('openInLookup'),
      onClick: () => void showLookup(item.hanzi),
    }),
    h(
      'div',
      { className: 'entry-body' },
      h('div', { className: 'entry-pinyin', text: item.pinyin }),
      h('div', { className: 'entry-defs', text: item.translation }),
      note,
      ...(settings.savedSort === 'practice' && item.again > 0 ? [h('div', { className: 'entry-missed', text: t('missedTimes', item.again) })] : []),
    ),
    h(
      'div',
      { className: 'entry-actions' },
      h('button', { text: '🔊', title: t('listenWord'), onClick: () => say(item.hanzi) }),
      h('button', { text: '✎', title: t('addNote'), onClick: () => editNote(item, note) }),
      del,
    ),
  );
}

function editNote(item: SavedItem, container: HTMLElement): void {
  const input = h('input');
  input.value = item.note;
  input.placeholder = t('notePlaceholder');
  container.replaceChildren(input);
  input.focus();
  let done = false;
  const finish = async (save: boolean) => {
    if (done) return;
    done = true;
    if (save && input.value !== item.note) await api.updateSaved(lang, item.id, { note: input.value.trim() });
    await refreshSaved();
    renderSaved();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void finish(true);
    if (e.key === 'Escape') void finish(false);
  });
  input.addEventListener('blur', () => void finish(true));
}

// ---- review view --------------------------------------------------------------------------------

let reviewItem: SavedItem | null = null;
let revealed = false;
let sessionReviewed = 0;

/** Weighted random pick: words you missed come up more, words you know come up less. */
function pickNext(): SavedItem | null {
  if (savedItems.length === 0) return null;
  const pool = savedItems.length > 1 ? savedItems.filter((i) => i.id !== reviewItem?.id) : savedItems;
  const weights = pool.map((i) => ((1 + i.again * 2) / (1 + i.correct)) * (i.reviewCount === 0 ? 2 : 1));
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

function startReview(): void {
  reviewItem = pickNext();
  revealed = false;
  renderReview();
}

function renderReview(): void {
  $('review-empty').hidden = !!reviewItem;
  $('review').hidden = !reviewItem;
  if (!reviewItem) return;
  $('review-stats').textContent = t('reviewStats', savedItems.length, sessionReviewed);
  const front = $('review-hanzi');
  front.textContent = reviewItem.hanzi;
  front.classList.toggle('en', lang === 'en');
  $('review-pinyin').textContent = reviewItem.pinyin;
  $('review-meaning').textContent = reviewItem.translation;
  $('review-answer').hidden = !revealed;
  $('review-prompt').hidden = revealed;
  $<HTMLButtonElement>('btn-again').disabled = !revealed;
  $<HTMLButtonElement>('btn-got').disabled = !revealed;
}

function reveal(): void {
  if (!reviewItem || revealed) return;
  revealed = true;
  renderReview();
  say(reviewItem.hanzi);
}

async function grade(gotIt: boolean): Promise<void> {
  if (!reviewItem || !revealed) return;
  revealed = false; // a second key press while this one is saving must not grade again
  const i = reviewItem;
  const forLang = lang;
  await api.updateSaved(forLang, i.id, {
    reviewCount: i.reviewCount + 1,
    correct: i.correct + (gotIt ? 1 : 0),
    again: i.again + (gotIt ? 0 : 1),
    lastReviewed: Date.now(),
  });
  if (forLang !== lang) return;
  sessionReviewed++;
  savedItems = await api.listSaved(lang);
  reviewItem = savedItems.find((s) => s.id === i.id) ?? null;
  startReview();
}

// ---- wiring -------------------------------------------------------------------------------------

function wire(): void {
  document.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) => {
    b.addEventListener('click', () => switchView(b.dataset.view as View));
  });
  $('btn-watch').addEventListener('click', () => void api.setSettings({ watchClipboard: !settings.watchClipboard }));
  $('btn-pin').addEventListener('click', () => void api.setSettings({ alwaysOnTop: !settings.alwaysOnTop }));
  $('btn-close').addEventListener('click', () => void api.hideWindow());
  $('btn-direction').addEventListener('click', () => void setLang(lang === 'en' ? 'zh' : 'en'));
  $('btn-mode').addEventListener('click', () => {
    void api.setSettings({ mode: settings.mode === 'hidden' ? 'card' : 'hidden' });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && settings.mode === 'hidden' && (e.target as HTMLElement).tagName !== 'INPUT') {
      void api.hideWindow();
    }
  });

  // In English mode 🔊 英 is British and 🔊 美 American; 🐢 uses the accent picked last.
  $('btn-speak').addEventListener('click', () => current && say(current.result.text, false, lang === 'en' ? 'en-GB' : 'zh'));
  $('btn-speak-us').addEventListener('click', () => current && say(current.result.text, false, 'en-US'));
  $('btn-slow').addEventListener('click', () => current && say(current.result.text, true));
  $('btn-save').addEventListener('click', async () => {
    const entry = current;
    if (!entry) return;
    const { result, translation } = entry;
    const pron = result.lang === 'en' ? pronText(result.pinyin, result.pinyinUs) : result.pinyin;
    await toggleSave($('btn-save'), renderResult, result.text, pron, translation ?? dictionaryGloss(result));
    // The translation may have arrived while the save was on its way to the main process.
    if (entry.translation) await replaceSavedGloss(result, entry.translation);
  });
  const answerNotice = (onlineTranslation: boolean) => void api.setSettings({ onlineTranslation, translationNoticeSeen: true });
  $('btn-allow-translation').addEventListener('click', () => answerNotice(true));
  $('btn-deny-translation').addEventListener('click', () => answerNotice(false));
  $('btn-copy-pinyin').addEventListener('click', async () => {
    if (!current) return;
    const { result } = current;
    await api.copyText(result.lang === 'en' ? pickAccent(result.pinyin, result.pinyinUs) : result.pinyin);
    toast(t('pronCopied'));
  });

  $('en-input').addEventListener('input', onTypeInput);
  $('en-input').addEventListener('search', onTypeInput); // Esc / the ✕ clear the box
  $('en-form').addEventListener('submit', (e) => {
    e.preventDefault();
    void submitTyped();
  });
  $('btn-en-speak').addEventListener('click', () => typed.output && say(typed.output, false, lang === 'en' ? 'en-GB' : 'zh'));
  $('btn-en-speak-us').addEventListener('click', () => typed.output && say(typed.output, false, 'en-US'));
  $('btn-en-save').addEventListener('click', () => {
    if (typed.output) void toggleSave($('btn-en-save'), renderTranslate, typed.output, typed.pron, typed.input);
  });
  const openTyped = () => typed.output && void showLookup(typed.output);
  $('btn-en-open').addEventListener('click', openTyped);
  $('en-hanzi').addEventListener('click', openTyped);

  $('search').addEventListener('input', renderSaved);
  const savedSort = $<HTMLSelectElement>('saved-sort');
  savedSort.addEventListener('change', () => void api.setSettings({ savedSort: savedSort.value as SavedSort }));
  $('btn-export').addEventListener('click', async () => {
    const file = await api.exportCsv(lang);
    if (file) toast(t('exported', file));
  });

  $('review-card').addEventListener('click', reveal);
  $('btn-review-speak').addEventListener('click', () => reviewItem && say(reviewItem.hanzi));
  $('btn-again').addEventListener('click', () => void grade(false));
  $('btn-got').addEventListener('click', () => void grade(true));
  document.addEventListener('keydown', (e) => {
    if ($('view-review').hidden || (e.target as HTMLElement).tagName === 'INPUT') return;
    if (e.key === ' ') {
      e.preventDefault();
      reveal();
    } else if (e.key === '1') void grade(false);
    else if (e.key === '2') void grade(true);
  });

  // Copied or highlighted text picks the mode: Chinese opens Hanzi Buddy, English opens 学英语.
  api.onIncomingText((text) => void showLookup(text));
  api.onNotice(toast);
  api.onSettings(applySettings);
  api.onOpenTranslate(() => {
    switchView('translate');
    const input = $<HTMLInputElement>('en-input');
    input.focus();
    input.select(); // type straight over the last query
  });
  // Esc clears the box (the browser does that for search inputs); Esc on an empty box puts it away.
  $('en-input').addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !(e.target as HTMLInputElement).value) void api.dismissTranslate();
  });
}

async function init(): Promise<void> {
  wire();
  applySettings(await api.getSettings());
  await refreshSaved();
}

void init();
