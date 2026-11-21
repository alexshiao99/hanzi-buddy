import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DOUBLE_TAP_MS, DoubleTapDetector } from '../src/main/double-tap';
import { doubleTapModifier, translateHotkeyLabel, translateHotkeyMenuLabel } from '../src/shared/hotkey';

describe('DoubleTapDetector', () => {
  it('fires on two quick taps', () => {
    const d = new DoubleTapDetector();
    assert.equal(d.feed('tap', 1000), false);
    assert.equal(d.feed('tap', 1000 + DOUBLE_TAP_MS - 50), true);
  });

  it('ignores taps that are too far apart', () => {
    const d = new DoubleTapDetector();
    d.feed('tap', 1000);
    assert.equal(d.feed('tap', 1000 + DOUBLE_TAP_MS + 1), false);
    // …but that second tap can start a new pair
    assert.equal(d.feed('tap', 1000 + DOUBLE_TAP_MS + 100), true);
  });

  it('does not fire when something else happened between taps', () => {
    const d = new DoubleTapDetector();
    d.feed('tap', 1000);
    d.feed('cancel', 1100);
    assert.equal(d.feed('tap', 1200), false);
  });

  it('needs a fresh pair after firing, so a triple tap fires once', () => {
    const d = new DoubleTapDetector();
    d.feed('tap', 1000);
    assert.equal(d.feed('tap', 1100), true);
    assert.equal(d.feed('tap', 1200), false);
  });

  it('ignores unknown lines', () => {
    const d = new DoubleTapDetector();
    d.feed('tap', 1000);
    assert.equal(d.feed('hello', 1050), false);
    assert.equal(d.feed('tap', 1100), true);
  });
});

describe('translate hotkey labels', () => {
  it('describes double taps and accelerators', () => {
    assert.equal(doubleTapModifier('DoubleOption'), 'option');
    assert.equal(doubleTapModifier('CommandOrControl+Shift+E'), null);
    assert.equal(translateHotkeyLabel('DoubleOption'), '⌥⌥');
    assert.equal(translateHotkeyLabel('CommandOrControl+Shift+E'), '⌘⇧E');
    assert.equal(translateHotkeyMenuLabel('DoubleControl'), 'Double-tap ⌃ Control');
    assert.equal(translateHotkeyMenuLabel('Off'), 'Off');
  });
});
