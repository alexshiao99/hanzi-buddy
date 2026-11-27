import { writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  net,
  screen,
  shell,
  Tray,
} from 'electron';
import type { AppMode, IncomingSource, SavedItem, Settings } from '../shared/types';
import { HOTKEY_CHOICES, hotkeyLabel as formatHotkey } from '../shared/hotkey';
import { ClipboardWatcher, grabSelection, hasAccessibility } from './capture';
import { Dictionary, translate } from './lookup';
import { SelectionWatcher } from './selection';
import { speak } from './speech';
import { SavedStore, SettingsStore } from './storage';

const isPrimaryInstance = app.requestSingleInstanceLock();
if (!isPrimaryInstance) app.quit();

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let dict: Dictionary | null = null;
let settings: SettingsStore;
let saved: SavedStore;
let watcher: ClipboardWatcher;
let selection: SelectionWatcher;
let dialogOpen = false;

/** bin/ and data/ sit in the project during development and in Contents/Resources once packaged. */
const resourcePath = (...parts: string[]) =>
  path.join(app.isPackaged ? process.resourcesPath : app.getAppPath(), ...parts);

/** Without the dictionary file, lookups still give pinyin and translation; word meanings are just empty. */
function getDict(): Dictionary {
  if (dict) return dict;
  try {
    dict = new Dictionary(resourcePath('data', 'cedict.txt'));
  } catch {
    dict = new Dictionary();
    notice('The dictionary file is missing, so word meanings are unavailable. Run npm install to download it.', 'dictionary missing');
  }
  return dict;
}
const isHidden = () => settings.get().mode === 'hidden';
const hotkeyLabel = () => formatHotkey(settings.get().hotkey);

// ---- window placement ---------------------------------------------------------------------------
// One window serves both modes. Placement is kept here so another layout (e.g. a bottom-of-screen
// strip) can be added later as a new mode.

const CARD_SIZE = { width: 400, height: 420 };
const POPUP_SIZE = { width: 380, height: 360 };

function cardBounds() {
  const saved = settings.get().bounds;
  if (saved) {
    const area = screen.getDisplayMatching(saved).workArea;
    const visible =
      saved.x < area.x + area.width - 40 && saved.x + saved.width > area.x + 40 &&
      saved.y >= area.y - 10 && saved.y < area.y + area.height - 40;
    if (visible) return saved;
  }
  const area = screen.getPrimaryDisplay().workArea;
  return {
    ...CARD_SIZE,
    x: area.x + area.width - CARD_SIZE.width - 24,
    y: area.y + area.height - CARD_SIZE.height - 24,
  };
}

/** Just below the mouse pointer, flipped above it / clamped so it stays on screen. */
function popupBounds() {
  const cursor = screen.getCursorScreenPoint();
  const area = screen.getDisplayNearestPoint(cursor).workArea;
  const { width, height } = POPUP_SIZE;
  let x = cursor.x - 40;
  let y = cursor.y + 18;
  if (y + height > area.y + area.height) y = cursor.y - height - 12;
  x = Math.max(area.x + 8, Math.min(x, area.x + area.width - width - 8));
  y = Math.max(area.y + 8, Math.min(y, area.y + area.height - height - 8));
  return { x, y, width, height };
}

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    ...(isHidden() ? popupBounds() : cardBounds()),
    minWidth: 330,
    minHeight: 170,
    frame: false,
    transparent: true,
    resizable: true,
    hasShadow: true,
    skipTaskbar: true,
    fullscreenable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  applyAlwaysOnTop(w, isHidden() || settings.get().alwaysOnTop);
  w.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  w.once('ready-to-show', () => {
    if (!isHidden()) w.showInactive();
  });

  // Only the card's position is remembered; the popup always opens at the cursor.
  let saveTimer: NodeJS.Timeout | undefined;
  const saveBounds = () => {
    if (isHidden()) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => settings.set({ bounds: w.getBounds() }), 400);
  };
  w.on('moved', saveBounds);
  w.on('resized', saveBounds);

  // In hidden mode the popup goes away as soon as you click elsewhere.
  w.on('blur', () => {
    if (isHidden() && !dialogOpen) hidePopup();
  });

  // Closing hides to the menu bar instead of quitting.
  w.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      w.hide();
    }
  });

  w.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  return w;
}

function applyAlwaysOnTop(w: BrowserWindow, onTop: boolean): void {
  w.setAlwaysOnTop(onTop, 'floating');
  w.setVisibleOnAllWorkspaces(onTop, { visibleOnFullScreen: true });
}

/** Card mode: show without stealing focus from what you're reading. */
function showCard(): void {
  if (win && !win.isVisible()) win.showInactive();
}

/** Hidden mode: open at the cursor and take focus so Esc / clicking away dismisses it. */
function showPopup(): void {
  if (!win) return;
  if (!win.isVisible()) win.setBounds(popupBounds());
  app.focus({ steal: true });
  win.show();
  win.focus();
}

function hidePopup(): void {
  if (!win?.isVisible()) return;
  win.hide();
  app.hide(); // hands focus back to the app you were reading in
}

function applyMode(mode: AppMode): void {
  if (!win) return;
  if (mode === 'hidden') {
    if (!hasAccessibility(false)) hasAccessibility(true);
    selection.start();
    applyAlwaysOnTop(win, true);
    hidePopup();
  } else {
    selection.stop();
    if (app.isHidden()) app.show(); // the popup hides the whole app, and a hidden app can't show windows
    applyAlwaysOnTop(win, settings.get().alwaysOnTop);
    win.setBounds(cardBounds());
    win.showInactive();
  }
  updateTrayTitle();
}

// ---- incoming text & notices ----------------------------------------------------------------------

/** Messages sent before the page has loaded would be lost, so those wait for it. */
function sendToRenderer(channel: string, ...args: unknown[]): void {
  if (!win) return;
  const { webContents } = win;
  if (webContents.isLoading()) webContents.once('did-finish-load', () => webContents.send(channel, ...args));
  else webContents.send(channel, ...args);
}

function sendIncoming(text: string, source: IncomingSource): void {
  if (isHidden()) {
    if (source === 'clipboard') return; // hidden mode only reacts to the hotkey
    showPopup();
  } else {
    // A closed card stays closed: copying text doesn't bring it back, only the hotkey or the 汉 menu does.
    if (source === 'clipboard' && !win?.isVisible()) return;
    showCard();
  }
  sendToRenderer('incoming-text', text, source);
  snapshot();
}

/** Dev aid: HANZI_SNAPSHOT=/some/dir saves a PNG of the window shortly after each lookup. */
function snapshot(): void {
  const dir = process.env.HANZI_SNAPSHOT;
  if (!dir || !win) return;
  const w = win;
  setTimeout(async () => {
    const img = await w.webContents.capturePage();
    writeFileSync(path.join(dir, `snapshot-${Date.now()}.png`), img.toPNG());
  }, 2500);
}

let flashTimer: NodeJS.Timeout | undefined;
/** In card mode notices appear as a toast; in hidden mode they flash briefly in the menu bar. */
function notice(message: string, short = message): void {
  if (isHidden()) {
    tray?.setTitle(`汉 ${short}`);
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      flashTimer = undefined;
      updateTrayTitle();
    }, 2500);
    return;
  }
  showCard();
  sendToRenderer('notice', message);
}

function updateSettings(patch: Partial<Settings>): Settings {
  const prev = settings.get();
  const prevMode = prev.mode;
  // Registering again even when unchanged retries a hotkey that failed at startup.
  if (patch.hotkey && !registerHotkey(patch.hotkey)) {
    const keeping = patch.hotkey !== prev.hotkey && registerHotkey(prev.hotkey) ? ` Keeping ${formatHotkey(prev.hotkey)}.` : '';
    notice(`${formatHotkey(patch.hotkey)} is used by another app.${keeping}`, 'hotkey unavailable');
    patch = { ...patch, hotkey: prev.hotkey };
  }
  const next = settings.set(patch);
  if (patch.watchClipboard !== undefined) {
    if (next.watchClipboard) watcher.start();
    else watcher.stop();
  }
  if (patch.alwaysOnTop !== undefined && win && !isHidden()) applyAlwaysOnTop(win, next.alwaysOnTop);
  if (next.mode !== prevMode) applyMode(next.mode);
  sendToRenderer('settings', next);
  rebuildTrayMenu();
  return next;
}

// ---- hotkey -------------------------------------------------------------------------------------

let grabbing = false;
async function onHotkey(): Promise<void> {
  if (grabbing) return;
  // Pressing the hotkey again while the popup is open closes it.
  if (isHidden() && win?.isVisible() && win.isFocused()) {
    hidePopup();
    return;
  }
  if (!hasAccessibility(false)) {
    hasAccessibility(true); // shows the macOS permission prompt
    notice(
      'To grab highlighted text, allow this app in System Settings → Privacy & Security → Accessibility, then try again.',
      'needs Accessibility permission',
    );
    return;
  }
  grabbing = true;
  try {
    // Hidden mode already knows the highlighted text; otherwise (or in apps that don't expose it) copy it.
    const highlighted = isHidden() && selection.current;
    if (highlighted) {
      sendIncoming(highlighted, 'hotkey');
      return;
    }
    const grabbed = await grabSelection(resourcePath('bin', 'clipboard-grab'), watcher);
    if (grabbed.status === 'text') sendIncoming(grabbed.text, 'hotkey');
    else if (grabbed.status === 'too-long') notice('That selection is too long. Select 300 characters or fewer.', 'selection too long');
    else if (grabbed.status === 'helper-missing') notice('The selection helper is missing. Install Xcode Command Line Tools and rebuild.', 'helper missing');
    else notice('No Chinese text selected.', 'no Chinese selected');
  } catch {
    notice('Could not copy the selection. Check the Accessibility permission.', 'could not read selection');
  } finally {
    grabbing = false;
  }
}

function registerHotkey(hotkey: string): boolean {
  globalShortcut.unregisterAll();
  try {
    return globalShortcut.register(hotkey, () => void onHotkey());
  } catch {
    return false; // not a valid accelerator (hand-edited settings)
  }
}

// ---- tray ---------------------------------------------------------------------------------------

/** In hidden mode the menu bar hints at the hotkey whenever Chinese text is highlighted. */
function updateTrayTitle(): void {
  if (!tray || flashTimer) return; // a notice is flashing; it restores the title when it ends
  tray.setTitle(isHidden() && selection.current ? `汉 ${hotkeyLabel()}` : '汉');
}

function rebuildTrayMenu(): void {
  if (!tray) return;
  const s = settings.get();
  const hidden = s.mode === 'hidden';
  tray.setContextMenu(
    Menu.buildFromTemplate([
      hidden
        ? { label: 'Show card', click: () => updateSettings({ mode: 'card' }) }
        : { label: win?.isVisible() ? 'Hide card' : 'Show card', click: () => toggleCard() },
      {
        label: 'Hidden mode',
        sublabel: `No window — highlight Chinese, press ${hotkeyLabel()}`,
        type: 'checkbox',
        checked: hidden,
        click: (i) => updateSettings({ mode: i.checked ? 'hidden' : 'card' }),
      },
      { type: 'separator' },
      { label: 'Watch clipboard', type: 'checkbox', checked: s.watchClipboard, enabled: !hidden, click: (i) => updateSettings({ watchClipboard: i.checked }) },
      { label: 'Always on top', type: 'checkbox', checked: s.alwaysOnTop, enabled: !hidden, click: (i) => updateSettings({ alwaysOnTop: i.checked }) },
      { label: 'Tone colors', type: 'checkbox', checked: s.toneColors, click: (i) => updateSettings({ toneColors: i.checked }) },
      {
        label: 'Online translation',
        sublabel: 'Sends looked-up text to Google Translate and MyMemory',
        type: 'checkbox',
        checked: s.onlineTranslation && s.translationNoticeSeen,
        click: (i) => updateSettings({ onlineTranslation: i.checked, translationNoticeSeen: true }),
      },
      { type: 'separator' },
      {
        label: 'Hotkey',
        submenu: HOTKEY_CHOICES.map((hotkey) => ({
          label: formatHotkey(hotkey),
          type: 'radio' as const,
          checked: hotkey === s.hotkey,
          click: () => updateSettings({ hotkey }),
        })),
      },
      { label: 'Open Accessibility settings…', click: () => void shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility') },
      { type: 'separator' },
      { label: 'Quit Hanzi Buddy', click: () => app.quit() },
    ]),
  );
}

function toggleCard(): void {
  if (!win) return;
  if (win.isVisible()) win.hide();
  else win.show();
  rebuildTrayMenu();
}

function createTray(): void {
  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip('Hanzi Buddy');
  updateTrayTitle();
  rebuildTrayMenu();
}

// ---- IPC ----------------------------------------------------------------------------------------

function registerIpc(): void {
  ipcMain.handle('lookup', (_e, text: string) => getDict().lookup(text));
  // net.fetch uses Chromium's network stack.
  ipcMain.handle('translate', (_e, text: string) => {
    const { onlineTranslation, translationNoticeSeen } = settings.get();
    if (!onlineTranslation || !translationNoticeSeen) return null;
    return translate(text, (url, init) => net.fetch(url, init));
  });
  ipcMain.handle('speak', (_e, text: string, slow: boolean) => speak(text, slow));
  ipcMain.handle('copy-text', (_e, text: string) => {
    watcher.markSeen(text);
    return clipboard.writeText(text);
  });

  ipcMain.handle('saved:list', () => saved.list());
  ipcMain.handle('saved:add', (_e, item: Pick<SavedItem, 'hanzi' | 'pinyin' | 'translation'>) => saved.add(item));
  ipcMain.handle('saved:update', (_e, id: string, patch: Partial<SavedItem>) => saved.update(id, patch));
  ipcMain.handle('saved:remove', (_e, id: string) => saved.remove(id));
  ipcMain.handle('saved:export', async () => {
    const opts = {
      defaultPath: path.join(app.getPath('downloads'), 'hanzi-buddy-words.csv'),
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    };
    dialogOpen = true; // don't auto-hide the popup while the save dialog has focus
    try {
      const { canceled, filePath } = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
      if (canceled || !filePath) return null;
      writeFileSync(filePath, '﻿' + saved.toCsv()); // BOM so Excel reads UTF-8 Chinese correctly
      return filePath;
    } finally {
      dialogOpen = false;
    }
  });

  ipcMain.handle('settings:get', () => settings.get());
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => updateSettings(patch));
  ipcMain.handle('window:hide', () => {
    if (isHidden()) hidePopup();
    else win?.hide();
    rebuildTrayMenu();
  });
}

// ---- lifecycle ----------------------------------------------------------------------------------

let quitting = false;
app.on('before-quit', () => {
  quitting = true;
});
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  selection?.stop();
});
app.on('second-instance', () => (isHidden() ? showPopup() : win?.show()));
app.on('window-all-closed', () => {
  /* keep running in the menu bar */
});

void app.whenReady().then(() => {
  if (!isPrimaryInstance) return; // app.quit() above is async; don't start a second copy meanwhile
  app.dock?.hide();
  const dir = app.getPath('userData');
  settings = new SettingsStore(dir);
  saved = new SavedStore(dir);
  watcher = new ClipboardWatcher((text) => sendIncoming(text, 'clipboard'));
  selection = new SelectionWatcher(resourcePath('bin', 'selection-watcher'), updateTrayTitle);

  registerIpc();
  win = createWindow();
  win.on('show', rebuildTrayMenu);
  win.on('hide', rebuildTrayMenu);
  createTray();
  const { hotkey } = settings.get();
  if (!registerHotkey(hotkey)) {
    notice(`${formatHotkey(hotkey)} is used by another app. Pick another hotkey in the 汉 menu.`, 'hotkey unavailable');
  }
  if (settings.get().watchClipboard) watcher.start();
  if (isHidden()) selection.start();
  setTimeout(getDict, 50); // warm the dictionary (~200ms) after the window is up
});
