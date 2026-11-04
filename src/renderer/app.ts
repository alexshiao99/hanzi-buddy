import type { HanziApi, LookupResult, SavedItem, Settings, WordInfo } from '../shared/types';

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

/** Strip tone marks so "xihuan" matches "xǐhuan" in search. */
const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

let toastTimer: number | undefined;
function toast(message: string): void {
  const t = $('toast');
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.hidden = true), 4000);
}

// ---- state --------------------------------------------------------------------------------------

type View = 'lookup' | 'saved' | 'review';

let settings: Settings;
let savedItems: SavedItem[] = [];
let current: { result: LookupResult; translation: string | null; translating: boolean } | null = null;
let lookupSeq = 0;

const savedByHanzi = (hanzi: string) => savedItems.find((i) => i.hanzi === hanzi);

async function refreshSaved(): Promise<void> {
  savedItems = await api.listSaved();
  $('saved-count').textContent = savedItems.length ? String(savedItems.length) : '';
  if (current) renderResult();
  if (!$('view-saved').hidden) renderSaved();
}

function switchView(view: View): void {
  for (const v of ['lookup', 'saved', 'review'] as View[]) $(`view-${v}`).hidden = v !== view;
  document.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === view);
  });
  if (view === 'saved') renderSaved();
  if (view === 'review') startReview();
}

function applySettings(s: Settings): void {
  settings = s;
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
  const mode = $('btn-mode');
  mode.textContent = popup ? '▣' : '◌';
  mode.title = popup
    ? 'Switch back to the floating card'
    : 'Hidden mode: no window. Highlight Chinese anywhere and press ⌘⇧Y for a popup.';
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

  const translation = await api.translate(result.text);
  if (seq !== lookupSeq || !current) return;
  current.translation = translation;
  current.translating = false;
  if (!translation) $('words').setAttribute('open', '');
  renderResult();
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

function phraseMeaning(): string {
  if (!current) return '';
  if (current.translation) return current.translation;
  return current.result.words
    .filter((w) => w.isHan && w.defs.length)
    .map((w) => w.defs[0])
    .join(' · ');
}

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
    tr.textContent = 'Phrase translation unavailable (offline?). Word meanings are below.';
    tr.classList.add('missing');
  }

  const isSaved = !!savedByHanzi(result.text);
  const saveBtn = $('btn-save');
  saveBtn.textContent = isSaved ? '★ Saved' : '☆ Save';
  saveBtn.classList.toggle('saved', isSaved);

  const hanWords = result.words.filter((w) => w.isHan);
  $('words').hidden = hanWords.length === 0;
  $('word-list').replaceChildren(...hanWords.map(wordRow));
}

function wordRow(word: WordInfo): HTMLLIElement {
  const saved = savedByHanzi(word.hanzi);
  const meaning = word.defs.slice(0, 4).join('; ');
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
      h('button', {
        text: saved ? '★' : '☆',
        className: saved ? 'saved' : '',
        title: saved ? 'Remove from saved' : 'Save this word',
        onClick: () => void toggleSave(word.hanzi, word.pinyin, word.defs.slice(0, 3).join('; ')),
      }),
    ),
  );
}

async function toggleSave(hanzi: string, pinyin: string, translation: string): Promise<void> {
  const existing = savedByHanzi(hanzi);
  if (existing) {
    await api.removeSaved(existing.id);
    toast(`Removed ${hanzi}`);
  } else {
    await api.addSaved({ hanzi, pinyin, translation });
    toast(`Saved ${hanzi}`);
  }
  await refreshSaved();
}

// ---- saved view ---------------------------------------------------------------------------------

function renderSaved(): void {
  const q = plain($<HTMLInputElement>('search').value.trim());
  const items = savedItems.filter(
    (i) => !q || [i.hanzi, i.pinyin, i.translation, i.note].some((f) => plain(f).includes(q)),
  );
  $('saved-empty').hidden = savedItems.length > 0;
  $('saved-list').replaceChildren(...items.map(savedRow));
}

function savedRow(item: SavedItem): HTMLLIElement {
  const note = h('div', { className: 'entry-note', text: item.note });
  const del = h('button', { text: '🗑', title: 'Delete' });
  let confirmTimer: number | undefined;
  del.addEventListener('click', async () => {
    if (!del.classList.contains('confirm')) {
      del.classList.add('confirm');
      del.textContent = 'Delete?';
      confirmTimer = window.setTimeout(() => {
        del.classList.remove('confirm');
        del.textContent = '🗑';
      }, 3000);
      return;
    }
    clearTimeout(confirmTimer);
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
  $('btn-save').addEventListener('click', () => {
    if (current) void toggleSave(current.result.text, current.result.pinyin, phraseMeaning());
  });
  $('btn-copy-pinyin').addEventListener('click', async () => {
    if (!current) return;
    await api.copyText(current.result.pinyin);
    toast('Pinyin copied');
  });

  $('search').addEventListener('input', renderSaved);
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
}

async function init(): Promise<void> {
  wire();
  applySettings(await api.getSettings());
  await refreshSaved();
  renderResult();
}

void init();
