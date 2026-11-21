# Hanzi Buddy 汉

A small floating, always-on-top macOS card for reading Chinese. Copy (or highlight + hotkey) any Simplified Chinese text and it shows tone-colored pinyin, an English translation, word-by-word dictionary meanings, read-aloud, and a saved list with flashcard review.

## Run

```bash
nvm use            # Node 26 (see .nvmrc)
npm install        # also downloads the CC-CEDICT dictionary into data/
npm start          # builds and launches
```

The app lives in the menu bar as **汉** (no Dock icon). The card is always either on screen or in hidden mode: closing it (✕) switches to hidden mode. Bring it back with **▣** in the popup or **Show card** in the 汉 menu, or quit from there.

The tabs are icons (hover for a tooltip): 🔍 Lookup · 文A Translate English → Chinese · ☆ Saved (with a count) · ▭ Review flashcards.

## Using it

- **Copy** any text containing Chinese (≤300 chars) and the card updates. Toggle with the ● button or the menu bar. Items password managers mark as concealed are ignored.
- **Highlight + ⌘⇧Y** grabs selected text without you copying it. The first time, macOS asks you to allow the app (shows as *Electron* while in dev) under System Settings → Privacy & Security → Accessibility. Your clipboard is restored afterward, including images, files and rich text. Pick a different hotkey under **Hotkey** in the 汉 menu.
- **EN→中** tab: type English and press Enter for a Chinese translation with pinyin, 🔊 Listen, ☆ Save and *Word by word →* (opens it in Lookup). While you type a word or short phrase (up to 4 words), it also lists matching words from the offline dictionary, so this part works without internet. Their order is a rough guess, since CC-CEDICT has no word-frequency data. Typing Chinese here opens the normal lookup.
- **Double-tap ⌃ Control** from any app opens EN→中 with the text box focused (in hidden mode, as a popup at the mouse). Type, press Enter. Double-tap again, or press Esc on an empty box, to go back to the app you were in. In card mode the card stays on screen. Pick ⇧⇧, ⌘⇧E or Off under **Translate shortcut** in the 汉 menu. (⌥⌥ isn't offered because Claude's quick-chat box uses it.) Needs the same Accessibility permission as the hotkey.
- **🔊 Listen / 🐢 Slow** reads aloud with the macOS Tingting voice (offline).
- **☆ Save** the phrase, or ☆ individual words in *Word by word*. Removing a saved item asks you to click twice, because its note and review history go with it.
- **Saved**: sort by **Recent**, **Pinyin A–Z** or **Needs practice**, search (tone marks optional: `xihuan` finds 喜欢), add notes (✎), delete, and **Export** to CSV (Anki-importable).
- **Review**: flashcards. Click or press Space to reveal, then **1** = Again, **2** = Got it. Missed words come up more often.

## Privacy

Phrase translation sends the text you look up to Google Translate and MyMemory. With **Watch clipboard** on, that includes any Chinese text you copy. English you translate in **EN→中** is sent when you press Enter (the dictionary matches shown while typing stay on your Mac). Nothing is sent until you answer the notice on first launch, and you can switch it off any time with **Online translation** in the 汉 menu. Pinyin, word meanings, speech and your saved words stay on your Mac.

## Hidden mode

No window at all. Turn it on with **✕** in the card header or **Hidden mode** in the 汉 menu (switch back with **▣** in the popup or the same menu item).

- Highlight Chinese text anywhere. The menu bar changes to **汉 ⌘⇧Y** to show it's ready.
- Press **⌘⇧Y** to open a popup next to your mouse with the full lookup (save, listen, Saved/Review tabs all work).
- **Esc**, ⌘⇧Y again, or clicking anywhere else closes it and returns focus to the app you were reading in.
- Copying text doesn't open anything in hidden mode; only the hotkey does.

Highlights are read by a small native helper (`native/selection-watcher.c`, compiled to `bin/` on build) through the macOS Accessibility API. It only passes along selections that contain Chinese characters and never reads password fields. For Chrome-family browsers it turns on Chrome's accessibility support (the same flag screen readers use) so page selections are readable. This can slow Chrome on heavy pages, and may last until you restart Chrome, even after quitting Hanzi Buddy. If an app doesn't expose its selection, ⌘⇧Y falls back to sending ⌘C through `native/clipboard-grab.m`. Debug the helper with `SELECTION_WATCHER_DEBUG=1 ./bin/selection-watcher`.

The translate shortcut uses `native/modifier-tap.c`, a listen-only event tap. It prints only `tap` (the modifier pressed and released on its own) and `cancel` (something else happened right after a tap). It never reports which keys you type, and the app decides what counts as a double tap (`src/main/double-tap.ts`). Debug it with `MODIFIER_TAP_DEBUG=1 ./bin/modifier-tap control`.

## How it works

| Piece | Source |
|---|---|
| Pinyin (context-aware: 银行 háng / 行走 xíng) | `pinyin-pro`, offline |
| Word segmentation (fewest words, then most even lengths) + meanings | CC-CEDICT, offline |
| English → Chinese dictionary matches | CC-CEDICT English meanings searched in reverse, offline (`Dictionary.english()`) |
| Phrase translation (both directions) | Google Translate free endpoint (unofficial, no key); MyMemory (free, ~5000 chars/day) is also asked if Google is slow (>1.5s) or fails. Without internet you still get pinyin + word meanings. |
| Speech | macOS `say` |
| Data | `~/Library/Application Support/Hanzi Buddy/` (`saved.json`, `settings.json`) |

## Code

```
src/main/      main.ts (window, modes, tray, hotkey, IPC) · lookup.ts · capture.ts · selection.ts · speech.ts · storage.ts
native/        selection-watcher.c — highlight watcher for hidden mode · modifier-tap.c — double-tap ⌃ watcher · clipboard-grab.m — ⌘C that restores the clipboard
src/preload/   preload.ts — typed bridge (HanziApi in src/shared/types.ts)
src/renderer/  index.html · styles.css · app.ts
test/          lookup, storage and selection tests
```

- `npm run typecheck` runs `tsc --noEmit`; the build uses esbuild (`scripts/build.mjs`).
- `npm test` runs the tests (needs the dictionary from `npm install`).
- `npm run dist` builds `release/Hanzi Buddy-*.dmg` for this Mac's architecture. It's ad-hoc signed, not notarized, so other Macs will warn on first open and macOS may ask for Accessibility again after each new build.
- `npm run test:lookup -- 我喜欢学中文` tests the lookup pipeline from the CLI.
- `HANZI_SNAPSHOT=/some/dir npm start` saves a PNG of the card after each lookup (for debugging).
- Window placement is isolated in `cardBounds()` and `popupBounds()` in `main.ts`, so a bottom-of-screen strip mode can be added later.

Dictionary: [CC-CEDICT](https://www.mdbg.net/chinese/dictionary?page=cc-cedict), CC BY-SA 4.0.
