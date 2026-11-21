import { hotkeyLabel, translateHotkeyLabel } from '../shared/hotkey';
import { groupSaved, plain } from '../shared/saved-order';
import type { EnglishMatch, HanziApi, LookupResult, SavedItem, SavedSort, Settings, WordInfo } from '../shared/types';

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
  const t = $('toast');
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.hidden = true), 4000);
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

function confirmClick(button: HTMLElement, restore: () => void, label = 'Delete?'): boolean {
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

let settings: Settings;
let savedItems: SavedItem[] = [];
let current: { result: LookupResult; translation: string | null; translating: boolean } | null = null;
let lookupSeq = 0;

const savedByHanzi = (hanzi: string) => savedItems.find((i) => i.hanzi === hanzi);

async function refreshSaved(): Promise<void> {
  savedItems = await api.listSaved();
  $('saved-count').textContent = savedItems.length ? String(savedItems.length) : '';
  if (current) renderResult();
  renderTranslate();
  if (!$('view-saved').hidden) renderSaved();
}

function switchView(view: View): void {
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

function applySettings(s: Settings): void {
  const couldTranslate = canTranslate(settings);
  const previousSort = settings?.savedSort;
  settings = s;
  $<HTMLSelectElement>('saved-sort').value = s.savedSort;
  if (s.savedSort !== previousSort && !$('view-saved').hidden) renderSaved();
  $('translation-notice').hidden = s.translationNoticeSeen;
  const label = hotkeyLabel(s.hotkey);
  const translateKey = translateHotkeyLabel(s.translateHotkey);
  $('en-hotkey-hint').textContent =
    s.translateHotkey === 'Off' ? '' : `Open this tab from anywhere with ${translateKey}.`;
  $('hotkey-hint').replaceChildren(...Array.from(label, (key) => h('kbd', { text: key })));
  document.body.classList.toggle('tones', s.toneColors);
  const watch = $('btn-watch');
  watch.classList.toggle('on', s.watchClipboard);
  watch.textContent = s.watchClipboard ? '●' : '○';
  watch.title = s.watchClipboard ? 'Watching clipboard (click to pause)' : 'Clipboard watching paused (click to resume)';
  const pin = $('btn-pin');
  pin.classList.toggle('on', s.alwaysOnTop);
  pin.title = s.alwaysOnTop ? 'Always on top (click to turn off)' : 'Not on top (click to keep on top)';

  const popup = s.mode === 'hidden';
  document.body.classList.toggle('popup', popup);
  $('btn-close').title = popup ? 'Close (Esc)' : `Close: switches to hidden mode (highlight Chinese, press ${label})`;
  const mode = $('btn-mode');
  mode.textContent = popup ? '▣' : '◌';
  mode.title = popup
    ? 'Switch back to the floating card'
    : `Hidden mode: no window. Highlight Chinese anywhere and press ${label} for a popup.`;

  if (current) {
    if (!couldTranslate && canTranslate(s)) void runTranslation(current.result, lookupSeq);
    else renderResult(); // the "translation off" message depends on these settings
  }
  renderTranslate();
}

// ---- speech -------------------------------------------------------------------------------------

const say = (text: string, slow = false) => void api.speak(text, slow);

// ---- lookup view --------------------------------------------------------------------------------

async function showLookup(text: string): Promise<void> {
  const seq = ++lookupSeq;
  switchView('lookup');
  const result = await api.lookup(text);
  if (seq !== lookupSeq) return;
  current = { result, translation: null, translating: true };
  renderResult();
  $('words').toggleAttribute('open', result.words.filter((w) => w.isHan).length <= 3);
  document.querySelector('main')?.scrollTo(0, 0);
  await runTranslation(result, seq);
}

async function runTranslation(result: LookupResult, seq: number): Promise<void> {
  if (current && seq === lookupSeq) {
    current.translating = true;
    renderResult();
  }
  const translation = await api.translate(result.text);
  // Runs even if another lookup has started, since this phrase may have been saved in the meantime.
  if (translation) await replaceSavedGloss(result, translation);
  if (seq !== lookupSeq || !current) return;
  current.translation = translation;
  current.translating = false;
  if (!translation) $('words').setAttribute('open', '');
  renderResult();
}

/** Upgrades a saved phrase that only has the dictionary fallback once its real translation is known. */
async function replaceSavedGloss(result: LookupResult, translation: string): Promise<void> {
  const item = savedByHanzi(result.text);
  if (!item || item.translation === translation || item.translation !== dictionaryGloss(result)) return;
  await api.updateSaved(item.id, { translation });
  await refreshSaved();
}

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
    const ruby = h('ruby', { className: `t${c.tone}` }, c.char, h('rt', { text: c.pinyin }));
    span.append(ruby);
  }
  span.addEventListener('click', () => say(word.hanzi));
  return span;
}

const dictionaryGloss = (result: LookupResult) =>
  result.words
    .filter((w) => w.isHan && w.defs.length)
    .map((w) => w.defs[0])
    .join(' · ');

function renderResult(): void {
  $('empty').hidden = !!current;
  $('result').hidden = !current;
  if (!current) return;
  const { result, translation, translating } = current;

  const hanzi = $('hanzi');
  const len = Array.from(result.text).length;
  hanzi.className = `hanzi ${len > 24 ? 'long' : len > 8 ? 'medium' : ''}`;
  hanzi.replaceChildren(...result.words.map(rubyFor));
  $('pinyin-line').textContent = result.pinyin;

  const tr = $('translation');
  tr.className = 'translation';
  if (translating) {
    tr.textContent = 'Translating…';
    tr.classList.add('pending');
  } else if (translation) {
    tr.textContent = translation;
  } else {
    tr.textContent = canTranslate(settings)
      ? 'Phrase translation unavailable (offline?). Word meanings are below.'
      : 'Online translation is off. Word meanings are below.';
    tr.classList.add('missing');
  }

  const isSaved = !!savedByHanzi(result.text);
  const saveBtn = $('btn-save');
  disarm(saveBtn);
  saveBtn.textContent = isSaved ? '★ Saved' : '☆ Save';
  saveBtn.classList.toggle('saved', isSaved);

  const hanWords = result.words.filter((w) => w.isHan);
  $('words').hidden = hanWords.length === 0;
  $('word-list').replaceChildren(...hanWords.map(wordRow));
}

function wordRow(word: WordInfo): HTMLLIElement {
  const saved = savedByHanzi(word.hanzi);
  const meaning = word.defs.slice(0, 4).join('; ');
  const starText = saved ? '★' : '☆';
  const star: HTMLButtonElement = h('button', {
    text: starText,
    className: saved ? 'saved' : '',
    title: saved ? 'Remove from saved' : 'Save this word',
    onClick: () =>
      void toggleSave(star, () => (star.textContent = starText), word.hanzi, word.pinyin, word.defs.slice(0, 3).join('; ')),
  });
  return h(
    'li',
    {},
    h('div', { className: 'entry-hanzi', text: word.hanzi, title: 'Listen', onClick: () => say(word.hanzi) }),
    h(
      'div',
      { className: 'entry-body' },
      h('div', { className: 'entry-pinyin', text: word.pinyin }),
      h('div', { className: 'entry-defs', text: meaning || '(not in dictionary)' }),
    ),
    h(
      'div',
      { className: 'entry-actions' },
      h('button', { text: '🔊', title: 'Listen', onClick: () => say(word.hanzi) }),
      star,
    ),
  );
}

/** Saving is one click. Removing also loses the note and review history, so it asks first. */
async function toggleSave(button: HTMLElement, restore: () => void, hanzi: string, pinyin: string, translation: string): Promise<void> {
  const existing = savedByHanzi(hanzi);
  if (existing) {
    if (!confirmClick(button, restore, 'Remove?')) return;
    await api.removeSaved(existing.id);
    toast(`Removed ${hanzi}`);
  } else {
    await api.addSaved({ hanzi, pinyin, translation });
    toast(`Saved ${hanzi}`);
  }
  await refreshSaved();
}

// ---- translate view (English → Chinese) --------------------------------------------------------

const HAN = /\p{Script=Han}/u;

interface EnState {
  english: string;
  /** Online answer and its pinyin; null while pending or unavailable. */
  chinese: string | null;
  pinyin: string;
  translating: boolean;
  submitted: boolean;
  matches: EnglishMatch[];
}

let en: EnState = { english: '', chinese: null, pinyin: '', translating: false, submitted: false, matches: [] };
let enSeq = 0;
let enTimer: number | undefined;

/** Dictionary matches update as you type; nothing is sent online until Enter. */
function onEnInput(): void {
  clearTimeout(enTimer);
  const text = $<HTMLInputElement>('en-input').value.trim();
  enTimer = window.setTimeout(async () => {
    const seq = ++enSeq;
    const matches = text && !HAN.test(text) ? await api.searchEnglish(text) : [];
    if (seq !== enSeq) return;
    en = { english: text, chinese: null, pinyin: '', translating: false, submitted: false, matches };
    renderTranslate();
  }, 200);
}

async function submitEnglish(): Promise<void> {
  clearTimeout(enTimer);
  const text = $<HTMLInputElement>('en-input').value.trim();
  if (!text) return;
  // Chinese typed or pasted here gets the normal lookup card.
  if (HAN.test(text)) return void showLookup(text);
  const seq = ++enSeq;
  en = { english: text, chinese: null, pinyin: '', translating: canTranslate(settings), submitted: true, matches: en.matches };
  renderTranslate();
  const [matches, chinese] = await Promise.all([api.searchEnglish(text), canTranslate(settings) ? api.translateToChinese(text) : null]);
  const pinyin = chinese ? (await api.lookup(chinese)).pinyin : '';
  if (seq !== enSeq) return;
  en = { english: text, chinese, pinyin, translating: false, submitted: true, matches };
  renderTranslate();
}

function renderTranslate(): void {
  const { chinese, pinyin, translating, submitted, matches, english } = en;
  $('en-empty').hidden = !!english;
  $('en-result').hidden = !chinese;
  if (chinese) {
    $('en-hanzi').textContent = chinese;
    const len = Array.from(chinese).length;
    $('en-hanzi').className = `hanzi ${len > 24 ? 'long' : len > 8 ? 'medium' : ''}`;
    $('en-pinyin').textContent = pinyin;
    const isSaved = !!savedByHanzi(chinese);
    const saveBtn = $('btn-en-save');
    disarm(saveBtn);
    saveBtn.textContent = isSaved ? '★ Saved' : '☆ Save';
    saveBtn.classList.toggle('saved', isSaved);
  }

  let message = '';
  if (translating) message = 'Translating…';
  else if (submitted && !chinese) {
    message = canTranslate(settings)
      ? 'Translation unavailable (offline?).'
      : 'Online translation is off (turn it on in the 汉 menu).';
    message += matches.length ? ' Dictionary matches are below.' : ' No dictionary matches either.';
  } else if (english && !submitted && !matches.length) message = 'Press Enter to translate.';
  const status = $('en-status');
  status.className = translating ? 'translation pending' : 'translation missing';
  status.textContent = message;
  status.hidden = !message;

  $('en-dict').hidden = matches.length === 0;
  $('en-list').replaceChildren(...matches.map(matchRow));
}

function matchRow(match: EnglishMatch): HTMLLIElement {
  const saved = savedByHanzi(match.hanzi);
  const starText = saved ? '★' : '☆';
  const star: HTMLButtonElement = h('button', {
    text: starText,
    className: saved ? 'saved' : '',
    title: saved ? 'Remove from saved' : 'Save this word',
    onClick: () =>
      void toggleSave(star, () => (star.textContent = starText), match.hanzi, match.pinyin, match.defs.slice(0, 3).join('; ')),
  });
  return h(
    'li',
    {},
    h('div', { className: 'entry-hanzi', text: match.hanzi, title: 'Open in Lookup', onClick: () => void showLookup(match.hanzi) }),
    h(
      'div',
      { className: 'entry-body' },
      h('div', { className: 'entry-pinyin', text: match.pinyin }),
      h('div', { className: 'entry-defs', text: match.defs.join('; ') }),
    ),
    h(
      'div',
      { className: 'entry-actions' },
      h('button', { text: '🔊', title: 'Listen', onClick: () => say(match.hanzi) }),
      star,
    ),
  );
}

// ---- saved view ---------------------------------------------------------------------------------

function renderSaved(): void {
  const q = plain($<HTMLInputElement>('search').value.trim());
  const items = savedItems.filter(
    (i) => !q || [i.hanzi, i.pinyin, i.translation, i.note].some((f) => plain(f).includes(q)),
  );
  $('saved-empty').hidden = savedItems.length > 0;
  $('saved-list').replaceChildren(
    ...groupSaved(items, settings.savedSort, Date.now()).flatMap((group) => [
      h('li', { className: 'saved-group', text: group.label }),
      ...group.items.map(savedRow),
    ]),
  );
}

function savedRow(item: SavedItem): HTMLLIElement {
  const note = h('div', { className: 'entry-note', text: item.note });
  const del = h('button', { text: '🗑', title: 'Delete' });
  del.addEventListener('click', async () => {
    if (!confirmClick(del, () => (del.textContent = '🗑'))) return;
    await api.removeSaved(item.id);
    await refreshSaved();
  });

  return h(
    'li',
    {},
    h('div', { className: 'entry-hanzi', text: item.hanzi, title: 'Open in Lookup', onClick: () => void showLookup(item.hanzi) }),
    h(
      'div',
      { className: 'entry-body' },
      h('div', { className: 'entry-pinyin', text: item.pinyin }),
      h('div', { className: 'entry-defs', text: item.translation }),
      note,
      ...(settings.savedSort === 'practice' && item.again > 0
        ? [h('div', { className: 'entry-missed', text: `missed ${item.again}×` })]
        : []),
    ),
    h(
      'div',
      { className: 'entry-actions' },
      h('button', { text: '🔊', title: 'Listen', onClick: () => say(item.hanzi) }),
      h('button', { text: '✎', title: 'Add a note', onClick: () => editNote(item, note) }),
      del,
    ),
  );
}

function editNote(item: SavedItem, container: HTMLElement): void {
  const input = h('input');
  input.value = item.note;
  input.placeholder = 'Note (e.g. where you saw it)';
  container.replaceChildren(input);
  input.focus();
  let done = false;
  const finish = async (save: boolean) => {
    if (done) return;
    done = true;
    if (save && input.value !== item.note) await api.updateSaved(item.id, { note: input.value.trim() });
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
  $('review-stats').textContent = `${savedItems.length} saved · ${sessionReviewed} reviewed this session`;
  $('review-hanzi').textContent = reviewItem.hanzi;
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
  await api.updateSaved(i.id, {
    reviewCount: i.reviewCount + 1,
    correct: i.correct + (gotIt ? 1 : 0),
    again: i.again + (gotIt ? 0 : 1),
    lastReviewed: Date.now(),
  });
  sessionReviewed++;
  savedItems = await api.listSaved();
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
  $('btn-mode').addEventListener('click', () => {
    void api.setSettings({ mode: settings.mode === 'hidden' ? 'card' : 'hidden' });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && settings.mode === 'hidden' && (e.target as HTMLElement).tagName !== 'INPUT') {
      void api.hideWindow();
    }
  });

  $('btn-speak').addEventListener('click', () => current && say(current.result.text));
  $('btn-slow').addEventListener('click', () => current && say(current.result.text, true));
  $('btn-save').addEventListener('click', async () => {
    if (!current) return;
    const { result, translation } = current;
    await toggleSave($('btn-save'), renderResult, result.text, result.pinyin, translation ?? dictionaryGloss(result));
    // The translation may have arrived while the save was on its way to the main process.
    if (current?.result === result && current.translation) await replaceSavedGloss(result, current.translation);
  });
  const answerNotice = (onlineTranslation: boolean) =>
    void api.setSettings({ onlineTranslation, translationNoticeSeen: true });
  $('btn-allow-translation').addEventListener('click', () => answerNotice(true));
  $('btn-deny-translation').addEventListener('click', () => answerNotice(false));
  $('btn-copy-pinyin').addEventListener('click', async () => {
    if (!current) return;
    await api.copyText(current.result.pinyin);
    toast('Pinyin copied');
  });

  $('en-input').addEventListener('input', onEnInput);
  $('en-input').addEventListener('search', onEnInput); // Esc / the ✕ clear the box
  $('en-form').addEventListener('submit', (e) => {
    e.preventDefault();
    void submitEnglish();
  });
  $('btn-en-speak').addEventListener('click', () => en.chinese && say(en.chinese));
  $('btn-en-save').addEventListener('click', () => {
    if (en.chinese) void toggleSave($('btn-en-save'), renderTranslate, en.chinese, en.pinyin, en.english);
  });
  const openEn = () => en.chinese && void showLookup(en.chinese);
  $('btn-en-open').addEventListener('click', openEn);
  $('en-hanzi').addEventListener('click', openEn);

  $('search').addEventListener('input', renderSaved);
  const savedSort = $<HTMLSelectElement>('saved-sort');
  savedSort.addEventListener('change', () => void api.setSettings({ savedSort: savedSort.value as SavedSort }));
  $('btn-export').addEventListener('click', async () => {
    const file = await api.exportCsv();
    if (file) toast(`Exported to ${file}`);
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
  renderResult();
}

void init();
