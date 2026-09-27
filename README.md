# Lauda for Windows and Linux

Lauda is a Markdown editor with a dual-pane layout: you write on the left
and see the rendered Markdown on the right, updated as you type.

This is the Electron edition, for Windows and Linux. Lauda is first a
native macOS app, written in Swift; this edition carries the same features
and the same layout to the other two platforms. It shares with the native
app its preview stylesheet, its translations and its welcome guides, and
its renderer and editing rules are ports of the native ones, tested against
the same cases.

## Features

- **Dual pane**: editor on the left, formatted preview on the right, with
  two-way scroll sync aligned by block, and an adjustable divider whose
  position is remembered.
- **Instant preview**: renders on every keystroke, off the window's thread,
  and repaints only the blocks that changed.
- **View modes**: editor only (Ctrl+1), split (Ctrl+2) or preview only
  (Ctrl+3), also in the toolbar. Preview-only mode offers three text widths.
- **Tabs**: every document opens as a tab of one window, and the files you
  leave open come back when you open Lauda again. Ctrl+Tab and
  Ctrl+Shift+Tab switch tabs; Ctrl+W or a middle click closes one.
- **Writing**: Ctrl+B, Ctrl+I, Ctrl+U, Ctrl+Shift+X and Ctrl+K; Return
  continues lists; Tab and Shift+Tab indent items; brackets, quotes and the
  `*`, `_` and `` ` `` markers close themselves, and typed over a selection
  they wrap it; `->` and `<-` become → and ← outside code; pasting a URL
  over a selection makes a link.
- **Images**: drag an image into the editor or paste a screenshot; it is
  copied next to the document and the Markdown link is written for you.
- **Outline**, **Find** (in every view mode, with a match counter) and
  **Find and Replace** (Ctrl+H).
- **Export** as standalone HTML or paginated PDF.
- **Documents**: autosave, Save As, Duplicate, Rename, Move To, Revert to
  Saved, recent files, and files changed by other programs reloaded.
- **Settings**: appearance (automatic, light or dark), editor and preview
  fonts and sizes, preview line height, strict line breaks.
- **Languages**: English and Brazilian Portuguese, reviewed; German,
  Simplified Chinese, French, Japanese and Spanish, drafts awaiting review.

On a Mac the shortcuts use ⌘ instead of Ctrl, as in the native app.

## Building

Node.js 22 or later.

```bash
npm install
node node_modules/electron/install.js   # npm 11 skips Electron's own download
npm start                               # builds into dist/ and runs the app
npm test                                # unit tests
npm run e2e                             # end-to-end tests, with Playwright
npm run typecheck
```

Packages go to `release/`:

```bash
npm run dist:linux   # AppImage, .deb and .rpm
npm run dist:win     # NSIS installer, x64 and arm64
```

Build Linux packages on Linux (or in a container) and Windows installers
on Windows. On a Mac with Apple silicon and no Rosetta, the AppImage and
NSIS tools don't run, but `npx electron-builder --linux deb` and
`npx electron-builder --win zip` (a portable folder) do.

The icons in `build/` come from one drawing, `build/icon.svg`:
`npm run icons` draws every size Windows and Linux show, each on its own,
with the margin each system's icons keep. Run it after changing the
drawing.

`npm run e2e` tests the development build; with `LAUDA_EXECUTABLE` set to
a packaged app's executable, the same tests run against it.
`LAUDA_PLATFORM=win32` (or `linux`) lays the window out as on that system,
to look at its title bar from another one.

## Differences from the native app

- The toolbar's Liquid Glass is imitated with translucency and blur; the
  real material is macOS's own.
- Browse All Versions is left out: it is macOS's version store.
- Word counts use the browser's word boundaries, which agree with macOS
  except in Japanese, which macOS splits its own way.
- The Markdown parser is a different one (micromark instead of cmark),
  made to produce the same HTML; a few unusual constructions still differ.

## Project layout

```
src/
  main/        # Electron's main process: the window, menus, files, dialogs, export
  preload/     # the window's only bridge to the main process
  renderer/    # the window: title bar and tabs, editor (CodeMirror), preview host, settings
  preview/     # the script inside the preview's page (the native preview.js)
  shared/      # Markdown renderer, editing rules, strings, settings: pure TypeScript
resources/     # preview stylesheet and font, welcome guides, strings
scripts/       # build, sync-native, the Windows packages and the icons
build/         # packaging resources: the icon's drawing and the icons drawn from it, the Windows installer's script, the Linux install scripts
test/          # unit tests (Vitest)
e2e/           # end-to-end tests (Playwright)
```

## Staying in step with the native app

`npm run sync-native` copies the preview stylesheet, the wordmark font, the
welcome guides and the string catalog (converted to JSON) from the native
repository, expected at `../markeditor` (or wherever `LAUDA_NATIVE`
points). Strings the native app gets from macOS, like the Edit menu's,
live in `resources/locales/app.json`.

## Platform notes

**Linux.** The .deb installs an AppArmor profile for Lauda, since Ubuntu
24.04 and later only let programs with a profile create the user
namespaces Chromium's sandbox needs. Lauda runs natively on Wayland.

**Windows.** Installers aren't code-signed yet; until they are, SmartScreen
warns before the first run.

## Security

The preview is a sandboxed frame with its own origin. Its page allows no
script but the app's own, so the document's raw HTML can't run any; images
load only from the document's folder, through a scheme that refuses
anything else; links open in the browser, and only http, https and mailto
ones. The window reaches the main process only through a fixed list of
requests.

## License

Lauda is released under the MIT License. See [LICENSE](LICENSE).

The preview embeds a small subset of [Newsreader](https://github.com/productiontype/Newsreader),
used for the app's name, under the SIL Open Font License 1.1
(`resources/preview/Newsreader-OFL.txt`).
