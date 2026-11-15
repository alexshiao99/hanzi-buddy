import { contextBridge, ipcRenderer } from 'electron';
import type { HanziApi } from '../shared/types';

const api: HanziApi = {
  lookup: (text) => ipcRenderer.invoke('lookup', text),
  translate: (text) => ipcRenderer.invoke('translate', text),
  speak: (text, slow) => ipcRenderer.invoke('speak', text, slow),
  copyText: (text) => ipcRenderer.invoke('copy-text', text),

  listSaved: () => ipcRenderer.invoke('saved:list'),
  addSaved: (item) => ipcRenderer.invoke('saved:add', item),
  updateSaved: (id, patch) => ipcRenderer.invoke('saved:update', id, patch),
  removeSaved: (id) => ipcRenderer.invoke('saved:remove', id),
  exportCsv: () => ipcRenderer.invoke('saved:export'),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  hideWindow: () => ipcRenderer.invoke('window:hide'),

  onIncomingText: (cb) => void ipcRenderer.on('incoming-text', (_e, text, source) => cb(text, source)),
  onNotice: (cb) => void ipcRenderer.on('notice', (_e, message) => cb(message)),
  onSettings: (cb) => void ipcRenderer.on('settings', (_e, s) => cb(s)),
};

contextBridge.exposeInMainWorld('hanzi', api);
