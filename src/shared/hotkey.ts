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

/**
 * The shortcut that opens EN→中 with the text box focused. "Double…" values are double taps of a
 * modifier key, watched by native/modifier-tap.c; anything else is an Electron accelerator.
 */
// Double-tap ⌥ isn't offered: Claude's quick-chat box already uses it.
export const TRANSLATE_HOTKEY_CHOICES = ['DoubleControl', 'DoubleShift', 'CommandOrControl+Shift+E', 'Off'];

const DOUBLE_TAPS: Record<string, { modifier: 'option' | 'control' | 'command' | 'shift'; label: string }> = {
  DoubleOption: { modifier: 'option', label: '⌥⌥' },
  DoubleControl: { modifier: 'control', label: '⌃⌃' },
  DoubleCommand: { modifier: 'command', label: '⌘⌘' },
  DoubleShift: { modifier: 'shift', label: '⇧⇧' },
};

export const doubleTapModifier = (hotkey: string) => DOUBLE_TAPS[hotkey]?.modifier ?? null;

/** "DoubleOption" → "⌥⌥", "Off" → "Off", accelerators as hotkeyLabel. */
export const translateHotkeyLabel = (hotkey: string): string =>
  hotkey === 'Off' ? 'Off' : DOUBLE_TAPS[hotkey]?.label ?? hotkeyLabel(hotkey);

/** Menu wording: "Double-tap ⌥ Option". */
export const translateHotkeyMenuLabel = (hotkey: string): string => {
  const names: Record<string, string> = { option: '⌥ Option', control: '⌃ Control', command: '⌘ Command', shift: '⇧ Shift' };
  const modifier = doubleTapModifier(hotkey);
  return modifier ? `Double-tap ${names[modifier]}` : translateHotkeyLabel(hotkey);
};
