# Contributing to Lauda for Windows and Linux

This is the Electron edition of Lauda. The native macOS app is the
reference: features, wording and behaviour come from it, and this edition
follows. See the README for what it does and how to build it.

## Before a commit

```bash
npm run check   # typecheck every part, lint (a warning fails it), unit tests
npm run e2e     # the end-to-end tests, which open the app's window
```

A change made for speed comes with numbers: `npm run measure` prints what
typing costs the window in a small and a 100 KB document, to run before
and after.

`npm run format` formats the code and sorts imports (Biome). Commit
messages follow [Conventional Commits](https://www.conventionalcommits.org/),
for example `fix(preview): …` or `feat(editor): …`.

## Where code goes

- **`src/shared`** holds the rules: the Markdown renderer, the editing
  rules, counts, settings, strings, the IPC contract. It is plain
  TypeScript with neither the DOM nor Node, and its tsconfig proves it:
  anything reaching for either fails to compile there. A rule that decides
  something goes here, with its tests, and the window or the main process
  only carries it out.
- **`src/main`** is the main process (Node). **`src/renderer`** is the
  window (DOM, no Node), **`src/worker`** the worker that renders and
  counts documents off the window's thread, **`src/preview`** the script
  inside the preview's page, and
  **`src/preload`** the bridge between window and main process. Each
  folder has a tsconfig with the libraries of the place it runs.
- Rules ported from the native app say which Swift file they come from,
  and their tests keep the native tests' cases and expected values.

## The bridge and the files

- The window reaches the main process only through the requests and
  events declared in `src/shared/ipc.ts`, typed on both sides. The
  preview's page and the worker speak through `preview-protocol.ts` and
  `worker-protocol.ts` the same way.
- The window's parts get the bridge, the strings and the platform from
  the `WindowContext` handed to their constructors, never from a module,
  so a test can build one with a context of its own (see
  `test/renderer/fakeContext.ts`).
- The main process answers requests from the app's own pages only, and
  file requests only about files it handed the window: opened, saved as,
  renamed or moved (`GrantedFiles`). A new request that takes a path
  checks it the same way.
- The main process follows each open document's file (`DocumentWatcher`
  in `files.ts`): another program's change, a rename in its folder, and
  the way to the Trash and back, told by which file it is (`trash.ts`),
  not by its name, since Windows renames what it bins. `doc:write` asks
  where the file is before writing, so nothing is written into the
  Trash, and an autosave never makes the file again where it was.

## The preview

The preview is a sandboxed frame of its own origin, served by the
`lauda-doc` scheme, which serves images from the document's folder and
nothing else. Its page allows no script but the app's own, so a
document's raw HTML can't run any. Links leave the app only with the
schemes in `content-policy.ts`.

## Tests

Unit tests (Vitest) cover the rules in `src/shared`, the window's logic
(documents, the search, the counts) with fakes of what it talks to, and
the parts of the main process that touch the disk, against temporary
folders they remove.
The end-to-end tests (Playwright) run the app with a data folder of its
own, so nothing of the reader's is touched, and a folder that stands for
the Trash (`LAUDA_TRASH`), so the real one never is. A test never writes
outside the folders it made.
They run out of sight (`LAUDA_OFFSCREEN`, which `e2e/launch.ts` sets):
the windows are wholly see-through, out of the Dock, let the pointer
through and never take the keyboard, so a run can go on while the reader
works. On macOS they also go off the screens, and the test of where a
window opens is left out there (macOS places it itself). That is measured
on macOS; on Linux a window can't be made see-through and shows.
`LAUDA_ONSCREEN=1 npm run e2e` shows them anywhere, to watch a run.

What Playwright and Electron don't do, and what the tests do instead:

- Keys typed through the page reach neither the system's menus nor the
  main process's `before-input-event`. A test clicks a menu item through
  `clickMenu` (`e2e/launch.ts`) and emits `before-input-event` on the
  window's `webContents` itself (see the Ctrl+Tab test). Items with a
  `role`, like Paste, act on the focused window, which a test's may not
  be: call `webContents.paste()` instead.
- `launch` passes `colorScheme: null`, or Playwright forces the light
  appearance on the app.
- Hovering the divider's handle at its middle never completes: the chain
  comes up under the pointer and takes it. Hover away from the middle, as
  the chain tests do.
- A hidden preview frame (`display: none`) loses its scroll position with
  no event, and back in view its first event is a scroll at the top.
  `DocumentView.setVisible` puts it back where it was.
- The main process's clipboard is asynchronous: `readText`, `read` and
  `write` return promises, and an image goes in as a `ClipboardItem`.
- Word counts are the native app's. Chromium's ICU splits a word like
  "example.com" at the full stop, where macOS keeps it whole, and
  `wordCount` joins the pieces again.

## Platform traps

- **Linux runs under X11.** On Wayland a window can't be kept above
  another (Settings fell behind the document window, whatever its
  `parent`), nor moved or resized once it is made. The switch has to be
  on the command line itself: `app.commandLine.appendSwitch` comes too
  late, and Electron no longer reads `ELECTRON_OZONE_PLATFORM_HINT`.
  `build.linux.executableArgs` in `package.json` puts
  `--ozone-platform=x11` in the `.desktop` launcher's `Exec` line, so it
  only applies from there: the AppImage file run directly, or `lauda`
  typed in a terminal, still runs on Wayland.
- A `<select>` whose menu stays open only while the button is held means
  the app is running on Wayland.
- GTK's message dialog centres a one-line detail but sets a wrapped one
  flush left under the centred message: keep a dialog's detail to one
  short line.
- GTK can't read a file inside the app's archive, and its save panel adds
  no extension: see `appIconFile` in `src/main/windows.ts` and
  `pathWithExtension` in `src/main/document-files.ts`.
- The Ubuntu fonts draw arrows tiny, so the system font stacks put the
  "Lauda Arrows" faces (DejaVu's arrows only) first: see `cssFontFamily`
  in `src/shared/settings.ts`.

## Staying in step with the native app

`npm run sync-native` copies the preview stylesheet, the wordmark font,
the welcome guides, the icon's drawing and the string catalog from the
native repository. Those files are the native app's: change them there.
`npm run icons` draws the icons from the drawing, the native app's too
(see the README). The
parser, `parser.ts`, does what a few of from-markdown's handlers do and
reads that library's internal state, so micromark, from-markdown and the
GFM extensions are pinned to exact versions; updating them is a step
taken on purpose, with the cmark compatibility tests.
