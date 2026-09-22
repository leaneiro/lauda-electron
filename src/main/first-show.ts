/// What showing a new window needs of it; a BrowserWindow has all of it.
export interface Showable {
  once(event: "ready-to-show", listener: () => void): unknown;
  isDestroyed(): boolean;
  isVisible(): boolean;
  show(): void;
  maximize(): void;
}

/// How long a new window waits for its page's first frame before it shows
/// anyway. Until the page draws, the window shows its background, which is
/// the page's own colour.
export const firstFrameWait = 3000;

/// Shows a new window once its page has drawn, so it never flashes empty,
/// or after `wait` when the page hasn't: a window left hidden is out of the
/// reader's reach, since opening the app again only hands this one the
/// files. `slow` hears of a page that took longer: with null when the
/// window showed without it, then with how long the first frame took.
export function showWhenDrawn(
  window: Showable,
  maximized: boolean,
  slow: (milliseconds: number | null) => void,
  wait = firstFrameWait,
): void {
  const started = Date.now();
  let isShown = false;
  const show = () => {
    if (isShown || window.isDestroyed()) return;
    isShown = true;
    // Brought forward already, by a second launch.
    if (window.isVisible()) return;
    if (maximized) window.maximize();
    window.show();
  };
  const timer = setTimeout(() => {
    if (isShown) return;
    slow(null);
    show();
  }, wait);
  window.once("ready-to-show", () => {
    clearTimeout(timer);
    const took = Date.now() - started;
    if (took > wait) slow(took);
    show();
  });
}
