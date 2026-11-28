export const DEFAULT_HOTKEY = 'CommandOrControl+Shift+Y';

export const HOTKEY_CHOICES = [
  DEFAULT_HOTKEY,
  'CommandOrControl+Alt+Y',
  'Control+Shift+Y',
  'Control+Alt+Y',
  'CommandOrControl+Shift+H',
];

/** "CommandOrControl+Shift+Y" → "⌘⇧Y" */
export const hotkeyLabel = (hotkey: string): string =>
  hotkey
    .replace('CommandOrControl', '⌘')
    .replace('Control', '⌃')
    .replace('Shift', '⇧')
    .replace('Alt', '⌥')
    .replace(/\+/g, '');
