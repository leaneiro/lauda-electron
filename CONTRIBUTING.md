# Contributing to Lauda for Windows and Linux

This is the Electron edition of Lauda. The native macOS app is the
reference: features, wording and behaviour come from it, and this edition
follows. See the README for what it does and how to build it.

## Before a commit

```bash
npm run check   # typecheck every part, lint, unit tests
npm run e2e     # the end-to-end tests, which open the app's window
```

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
  window (DOM, no Node), **`src/worker`** the render worker,
  **`src/preview`** the script inside the preview's page, and
  **`src/preload`** the bridge between window and main process. Each
  folder has a tsconfig with the libraries of the place it runs.
- Rules ported from the native app say which Swift file they come from,
  and their tests keep the native tests' cases and expected values.

## The bridge and the files

- The window reaches the main process only through the requests and
  events declared in `src/shared/ipc.ts`, typed on both sides.
- The main process answers requests from the app's own pages only, and
  file requests only about files it handed the window: opened, saved as,
  renamed or moved (`GrantedFiles`). A new request that takes a path
  checks it the same way.

## The preview

The preview is a sandboxed frame of its own origin, served by the
`lauda-doc` scheme, which serves images from the document's folder and
nothing else. Its page allows no script but the app's own, so a
document's raw HTML can't run any. Links leave the app only with the
schemes in `content-policy.ts`.

## Tests

Unit tests (Vitest) cover the rules in `src/shared` and the parts of the
main process that touch the disk, against temporary folders they remove.
The end-to-end tests (Playwright) run the app with a data folder of its
own, so nothing of the reader's is touched. A test never writes outside
the folders it made.

## Staying in step with the native app

`npm run sync-native` copies the preview stylesheet, the wordmark font,
the welcome guides, the icons and the string catalog from the native
repository. Those files are the native app's: change them there. The
parser, `parser.ts`, does what a few of from-markdown's handlers do and
reads that library's internal state, so micromark, from-markdown and the
GFM extensions are pinned to exact versions; updating them is a step
taken on purpose, with the cmark compatibility tests.
