export const HOTKEY_CHOICES = [
  'CommandOrControl+Shift+Y',
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
