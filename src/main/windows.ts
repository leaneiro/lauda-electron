import { join } from "node:path";
import { app, BrowserWindow, nativeTheme, screen, type WebContents } from "electron";
import type { Events } from "../shared/ipc";
import { logNote } from "./log";
import { placeWindow } from "./placement";
import { appOrigin, distDirectory } from "./protocols";
import { readWindowState, windowStateFile } from "./store";

const isMac = process.platform === "darwin";

/// The windows' background before their pages draw: the page's own colour
/// (--window-bg in app.css; Settings is the lighter grey of a sheet).
export function windowBackground(kind: "document" | "settings" = "document"): string {
  if (nativeTheme.shouldUseDarkColors) return "#1e1e1e";
  return kind === "settings" ? "#f5f5f7" : "#ffffff";
}

/// Windows and Linux draw the window's buttons over the title bar, in its
/// colours, one point short of it: the bar's bottom line (--titlebar-height
/// in app.css, its last point) then runs on under them.
export function titleBarOverlay(): Electron.TitleBarOverlayOptions {
  const dark = nativeTheme.shouldUseDarkColors;
  return { color: windowBackground(), symbolColor: dark ? "#e6e6e9" : "#1d1d1f", height: 51 };
}

const webPreferences: Electron.WebPreferences = {
  preload: join(__dirname, "preload.js"),
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  spellcheck: false,
};

/// The one window every document lives in, and the three things its life
/// turns on, which were loose flags before: whether its page can hear
/// events yet, whether every tab has answered a close, and whether the app
/// is quitting by way of it. Each changes through a named step below.
export class DocumentWindow {
  private window: BrowserWindow | null = null;
  /// The page has asked for its first state (app:init). Events sent before
  /// that would be lost, so they wait for it.
  private pageIsReady = false;
  private readonly waiting: (() => void)[] = [];
  /// Every tab has answered (kept, saved or dropped), so the next close
  /// goes through.
  private closeIsConfirmed = false;
  private quitting = false;

  /// `onClosed` runs when the window has gone: whatever hangs on it goes too.
  constructor(private readonly onClosed: () => void) {}

  get current(): BrowserWindow | null {
    return this.window;
  }

  get isQuitting(): boolean {
    return this.quitting;
  }

  send<C extends keyof Events>(channel: C, payload: Events[C]): void {
    this.window?.webContents.send(channel, payload);
  }

  /// Runs `action` once the page can hear events, opening the window when
  /// there is none.
  whenReady(action: () => void): void {
    this.ensure();
    if (this.pageIsReady) action();
    else this.waiting.push(action);
  }

  /// The page has asked for its first state. What waited goes out after
  /// the answer, which the page needs before anything else.
  pageAskedForState(sender: WebContents): void {
    if (sender !== this.window?.webContents) return;
    setImmediate(() => {
      this.pageIsReady = true;
      for (const action of this.waiting.splice(0)) action();
    });
  }

  /// Quitting asks the window first: unsaved untitled text is reviewed and
  /// every file is written. True when the quit has to wait for the answer.
  askToQuit(): boolean {
    if (!this.window || this.closeIsConfirmed) return false;
    this.quitting = true;
    this.send("workspace:close-everything", { reason: "quit" });
    return true;
  }

  /// The tabs have answered: everything is closed, or someone cancelled,
  /// which cancels the quit as well.
  everythingClosed(ok: boolean): void {
    if (!ok) {
      this.quitting = false;
      return;
    }
    this.closeIsConfirmed = true;
    this.window?.close();
  }

  /// A second launch brings the window forward, with files to open or
  /// without. False when there is no window to bring.
  bringForward(): boolean {
    if (!this.window) return false;
    // Still waiting for its page to draw: the reader asked for it, so it
    // shows now.
    if (!this.window.isVisible()) this.window.show();
    if (this.window.isMinimized()) this.window.restore();
    this.window.focus();
    return true;
  }

  themeChanged(): void {
    if (!this.window) return;
    this.window.setBackgroundColor(windowBackground());
    if (!isMac) this.window.setTitleBarOverlay(titleBarOverlay());
  }

  ensure(): BrowserWindow {
    if (this.window) return this.window;
    const state = readWindowState();
    const place = placeWindow(
      state,
      [screen.getPrimaryDisplay(), ...screen.getAllDisplays()].map((display) => display.workArea),
    );
    const window = new BrowserWindow({
      ...place,
      minWidth: 700,
      minHeight: 500,
      show: false,
      title: "Lauda",
      backgroundColor: windowBackground(),
      titleBarStyle: "hidden",
      ...(isMac ? { trafficLightPosition: { x: 19, y: 19 } } : { titleBarOverlay: titleBarOverlay() }),
      ...(process.platform === "linux" ? { icon: join(distDirectory, "resources/icons/AppIcon-512.png") } : {}),
      webPreferences,
    });
    this.window = window;
    this.pageIsReady = false;
    this.closeIsConfirmed = false;
    if (!isMac) window.setMenuBarVisibility(false);
    window.loadURL(`${appOrigin}/renderer/index.html`);
    // Shown at once, in the page's own background colour, rather than once
    // the page has drawn: waiting for that left the window hidden for good
    // when the first frame never came (a Windows virtual machine), and
    // Electron advises showing at once where it may come late.
    if (state?.maximized) window.maximize();
    window.show();
    window.on("unresponsive", () => logNote("app", "The window stopped responding"));
    this.rememberBounds(window);
    this.reportState(window);

    // The close button means every tab. The window asks each document in
    // turn (untitled text asks whether to keep it) and answers; only then
    // does it really close. On Windows and Linux closing the window is how
    // the app quits, so the tabs are remembered for the next launch.
    window.on("close", (event) => {
      if (this.closeIsConfirmed) return;
      event.preventDefault();
      this.send("workspace:close-everything", { reason: this.quitting || !isMac ? "quit" : "window" });
    });
    window.on("closed", () => {
      this.window = null;
      this.pageIsReady = false;
      this.onClosed();
      if (this.quitting) app.quit();
    });
    return window;
  }

  /// Where the window is and how big, kept for the next launch once it
  /// stops moving.
  private rememberBounds(window: BrowserWindow): void {
    let saveTimer: NodeJS.Timeout | undefined;
    const remember = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        if (window.isDestroyed() || window.isMinimized() || window.isFullScreen()) return;
        windowStateFile.write({ ...window.getNormalBounds(), maximized: window.isMaximized() });
      }, 400);
    };
    window.on("resize", remember);
    window.on("move", remember);
  }

  /// Full screen and focus, which the page lays its title bar out by.
  private reportState(window: BrowserWindow): void {
    const report = () => {
      if (window.isDestroyed()) return;
      this.send("window:state", { isFullScreen: window.isFullScreen(), isFocused: window.isFocused() });
    };
    for (const event of ["enter-full-screen", "leave-full-screen", "focus", "blur"] as const) {
      window.on(event as "focus", report);
    }
  }
}

/// Settings, one window at a time, over the document window.
export class SettingsWindow {
  private window: BrowserWindow | null = null;
  private isRevealed = false;

  constructor(private readonly context: { title: () => string; parent: () => BrowserWindow | null }) {}

  show(): void {
    if (this.window) {
      this.window.focus();
      return;
    }
    const window = new BrowserWindow({
      width: 480,
      height: 540,
      useContentSize: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      show: false,
      title: this.context.title(),
      parent: this.context.parent() ?? undefined,
      backgroundColor: windowBackground("settings"),
      webPreferences,
    });
    this.window = window;
    this.isRevealed = false;
    window.setMenu(null);
    window.loadURL(`${appOrigin}/renderer/settings.html`);
    // It shows once its form has said how tall it is (fitContent), so it
    // opens at its size; the form says so as soon as it is laid out, frame
    // or no frame. The first frame shows it too, should the form not speak.
    window.once("ready-to-show", () => this.reveal());
    window.on("closed", () => {
      this.window = null;
    });
  }

  close(): void {
    this.window?.close();
  }

  /// As tall as its form, as the native one is.
  fitContent(height: number): void {
    if (!this.window || !Number.isFinite(height)) return;
    this.window.setContentSize(480, Math.ceil(Math.min(Math.max(height, 200), 900)));
    this.reveal();
  }

  /// Shows the window the first time it is ready, and only then: later
  /// fittings (the fonts arriving) leave it as the reader has it.
  private reveal(): void {
    if (this.isRevealed || !this.window || this.window.isDestroyed()) return;
    this.isRevealed = true;
    this.window.show();
  }
}
