# Hanzi Buddy 汉

A small floating, always-on-top macOS card for reading Chinese. Copy (or highlight + hotkey) any Simplified Chinese text and it shows tone-colored pinyin, an English translation, word-by-word dictionary meanings, read-aloud, and a saved list with flashcard review.

## Run

```bash
nvm use            # Node 26 (see .nvmrc)
npm install        # also downloads the CC-CEDICT dictionary into data/
npm start          # builds and launches
```

The app lives in the menu bar as **汉** (no Dock icon). Closing the card hides it; reopen or quit from the menu bar.

## Using it

- **Copy** any text containing Chinese (≤300 chars) and the card updates. Toggle with the ● button or the menu bar.
- **Highlight + ⌘⇧Y** grabs selected text without you copying it. The first time, macOS asks you to allow the app (shows as *Electron* while in dev) under System Settings → Privacy & Security → Accessibility. Your previous clipboard text is restored afterward. Release the keys quickly; the app waits about 0.2 s before sending ⌘C.
- **🔊 Listen / 🐢 Slow** reads aloud with the macOS Tingting voice (offline).
- **☆ Save** the phrase, or ☆ individual words in *Word by word*.
- **Saved**: search (tone marks optional: `xihuan` finds 喜欢), add notes (✎), delete, and **Export** to CSV (Anki-importable).
- **Review**: flashcards. Click or press Space to reveal, then **1** = Again, **2** = Got it. Missed words come up more often.

## Hidden mode

No window at all. Turn it on with the **◌** button in the card header or **Hidden mode** in the 汉 menu (switch back with **▣** in the popup or the same menu item).

- Highlight Chinese text anywhere. The menu bar changes to **汉 ⌘⇧Y** to show it's ready.
- Press **⌘⇧Y** to open a popup next to your mouse with the full lookup (save, listen, Saved/Review tabs all work).
- **Esc**, ⌘⇧Y again, or clicking anywhere else closes it and returns focus to the app you were reading in.
- Copying text doesn't open anything in hidden mode; only the hotkey does.

Highlights are read by a small native helper (`native/selection-watcher.c`, compiled to `bin/` on build) through the macOS Accessibility API. It only passes along selections that contain Chinese characters and never reads password fields. For Chrome-family browsers it turns on Chrome's accessibility support (the same flag screen readers use) so page selections are readable. If an app doesn't expose its selection, ⌘⇧Y falls back to sending ⌘C. Debug the helper with `SELECTION_WATCHER_DEBUG=1 ./bin/selection-watcher`.

## How it works

| Piece | Source |
|---|---|
| Pinyin (context-aware: 银行 háng / 行走 xíng) | `pinyin-pro`, offline |
| Word segmentation + meanings | CC-CEDICT, offline |
| Phrase translation | Google Translate free endpoint; MyMemory (free, ~5000 chars/day) is also asked if Google is slow (>1.5s) or fails. Without internet you still get pinyin + word meanings. |
| Speech | macOS `say` |
| Data | `~/Library/Application Support/Hanzi Buddy/` (`saved.json`, `settings.json`) |

## Code

```
src/main/      main.ts (window, modes, tray, hotkey, IPC) · lookup.ts · capture.ts · selection.ts · speech.ts · storage.ts
native/        selection-watcher.c — highlight watcher for hidden mode
src/preload/   preload.ts — typed bridge (HanziApi in src/shared/types.ts)
src/renderer/  index.html · styles.css · app.ts
```

- `npm run typecheck` runs `tsc --noEmit`; the build uses esbuild (`scripts/build.mjs`).
- `npm run test:lookup -- 我喜欢学中文` tests the lookup pipeline from the CLI.
- `HANZI_SNAPSHOT=/some/dir npm start` saves a PNG of the card after each lookup (for debugging).
- Window placement is isolated in `createWindow(mode)` in `main.ts`, so a bottom-of-screen strip mode can be added later.

Dictionary: [CC-CEDICT](https://www.mdbg.net/chinese/dictionary?page=cc-cedict), CC BY-SA 4.0.
