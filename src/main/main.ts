import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, shell, systemPreferences, type IpcMainInvokeEvent } from "electron";
import { existsSync, readFileSync, statSync } from "node:fs";
import { copyFile, rename, rm } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { pickLocale, Strings } from "../shared/i18n";
import type { Events, MenuCommand, MenuState, OpenDocument, Requests, RequestChannel } from "../shared/ipc";
import { allowedLinkSchemes } from "../shared/markdown";
import type { AppearanceMode } from "../shared/settings";
import { exportHTML, exportPDF } from "./export";
import { DocumentWatcher, readText, writeText } from "./files";
import { installedFontFamilies } from "./fonts";
import { importImages, savePastedImage, uniqueDestination } from "./images";
import { buildMenu } from "./menu";
import {
  appOrigin,
  distDirectory,
  forgetDocumentFolder,
  handleProtocols,
  registerDocumentFolder,
  registerSchemes,
} from "./protocols";
import { readSession, readWindowState, RecentFiles, sessionFile, SettingsStore, windowStateFile } from "./store";

const isMac = process.platform === "darwin";
const isWindows = process.platform === "win32";

// On a Mac this build only runs next to the native app, which must not see
// its settings or window state change. Tests bring a folder of their own.
if (process.env.LAUDA_USER_DATA) app.setPath("userData", process.env.LAUDA_USER_DATA);
else if (isMac) app.setPath("userData", join(app.getPath("appData"), "Lauda Electron"));
app.setName("Lauda");
registerSchemes();

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

const buildInfo: { version: string; gitHash: string } = (() => {
  try {
    return JSON.parse(readFileSync(join(distDirectory, "build-info.json"), "utf8"));
  } catch {
    return { version: app.getVersion(), gitHash: "dev" };
  }
})();

let settings: SettingsStore;
let recentFiles: RecentFiles;
let strings: Strings;
let workspaceWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
/// Set once the window's page answered app:init; opening waits for it.
let windowIsReady = false;
const whenWindowReady: (() => void)[] = [];
/// Files asked for before the app was ready (the Finder, the command line).
const filesToOpen: string[] = [];
let isReady = false;
let isQuitting = false;
let closeIsConfirmed = false;
let menuState: MenuState = { hasDocument: false, hasFile: false, documentCount: 0, viewMode: "split" };

const watcher = new DocumentWatcher((filePath, text) => send("doc:changed-on-disk", { filePath, text }));

function send<C extends keyof Events>(channel: C, payload: Events[C]): void {
  workspaceWindow?.webContents.send(channel, payload);
}

function sendCommand(command: MenuCommand): void {
  withWindow(() => send("menu:command", command));
}

// MARK: - Opening

const markdownExtensions = ["md", "markdown", "mdown", "mkd", "mkdn", "mdwn", "mdtxt", "mdtext", "text", "txt"];

/// Opens the files one after another, so their tabs keep this order
/// whatever each one takes to read. A file already open comes forward.
async function openFiles(paths: string[], select?: string | null): Promise<void> {
  if (!isReady) {
    filesToOpen.push(...paths);
    return;
  }
  const window = ensureWindow();
  for (const filePath of paths) {
    try {
      const text = await readText(filePath);
      recentFiles.note(filePath);
      withWindow(() => send("workspace:open", { filePath, text }));
    } catch (error) {
      recentFiles.forget(filePath);
      await dialog.showMessageBox(window, {
        type: "warning",
        message: strings.t("Couldn't open “%@”", basename(filePath)),
        detail: error instanceof Error ? error.message : String(error),
        buttons: [strings.t("OK")],
      });
    }
  }
  if (select && paths.includes(select)) {
    withWindow(() => send("workspace:open", { filePath: select, text: "" }));
  }
}

async function showOpenDialog(): Promise<void> {
  const options: Electron.OpenDialogOptions = {
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: strings.t("Markdown Document"), extensions: markdownExtensions.slice(0, 8) },
      { name: strings.t("Plain Text"), extensions: ["txt", "text"] },
      { name: strings.t("All Files"), extensions: ["*"] },
    ],
  };
  const result = workspaceWindow
    ? await dialog.showOpenDialog(workspaceWindow, options)
    : await dialog.showOpenDialog(options);
  if (!result.canceled) await openFiles(result.filePaths);
}

function welcomeGuideText(): string {
  const tryRead = (language: string) => {
    try {
      return readFileSync(join(distDirectory, "resources/welcome", `${language}.md`), "utf8");
    } catch {
      return null;
    }
  };
  return tryRead(strings.locale) ?? tryRead("en") ?? "";
}

/// The guide opens as an untitled document holding its text, so people can
/// experiment freely and save it only if they want to.
function showWelcomeGuide(): void {
  ensureWindow();
  const document: OpenDocument = { filePath: null, text: welcomeGuideText(), title: strings.t("Welcome") };
  withWindow(() => send("workspace:open", document));
}

/// A launch with nothing to open: the guide the first time, then the tabs
/// left open last time. With neither, the Mac offers to open something, as
/// the native app does; Windows and Linux start a new document instead,
/// since a Save dialog with no window reads as the app failing to start.
async function launchWithoutFiles(): Promise<void> {
  if (!settings.value.hasShownWelcomeGuide) {
    settings.update({ hasShownWelcomeGuide: true });
    showWelcomeGuide();
    return;
  }
  const session = readSession();
  const existing = session.files.filter((file) => existsSync(file));
  if (existing.length > 0) {
    await openFiles(existing, session.selected);
  } else if (isMac) {
    await showOpenDialog();
  } else {
    ensureWindow();
    sendCommand({ name: "new" });
  }
}

function filesInArguments(argv: string[]): string[] {
  const args = argv.slice(app.isPackaged ? 1 : 2);
  return args.filter((arg) => {
    if (arg.startsWith("-")) return false;
    try {
      return statSync(arg).isFile();
    } catch {
      return false;
    }
  });
}

// MARK: - The window

function titleBarOverlay(): Electron.TitleBarOverlayOptions {
  const dark = nativeTheme.shouldUseDarkColors;
  return { color: dark ? "#1e1e1e" : "#ffffff", symbolColor: dark ? "#e6e6e9" : "#1d1d1f", height: 52 };
}

function ensureWindow(): BrowserWindow {
  if (workspaceWindow) return workspaceWindow;
  const state = readWindowState();
  const window = new BrowserWindow({
    width: state?.width ?? 1200,
    height: state?.height ?? 800,
    x: state?.x,
    y: state?.y,
    minWidth: 700,
    minHeight: 500,
    show: false,
    title: "Lauda",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1e1e1e" : "#ffffff",
    titleBarStyle: "hidden",
    ...(isMac ? { trafficLightPosition: { x: 19, y: 19 } } : { titleBarOverlay: titleBarOverlay() }),
    ...(process.platform === "linux" ? { icon: join(distDirectory, "resources/icons/AppIcon-512.png") } : {}),
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  workspaceWindow = window;
  windowIsReady = false;
  closeIsConfirmed = false;
  if (!isMac) window.setMenuBarVisibility(false);
  window.loadURL(`${appOrigin}/renderer/index.html`);
  window.once("ready-to-show", () => {
    if (state?.maximized) window.maximize();
    window.show();
  });

  let saveTimer: NodeJS.Timeout | undefined;
  const rememberBounds = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (window.isDestroyed() || window.isMinimized() || window.isFullScreen()) return;
      const bounds = window.getNormalBounds();
      windowStateFile.write({ ...bounds, maximized: window.isMaximized() });
    }, 400);
  };
  window.on("resize", rememberBounds);
  window.on("move", rememberBounds);
  const reportState = () => {
    if (!window.isDestroyed()) {
      send("window:state", { isFullScreen: window.isFullScreen(), isFocused: window.isFocused() });
    }
  };
  for (const event of ["enter-full-screen", "leave-full-screen", "focus", "blur"] as const) {
    window.on(event as "focus", reportState);
  }

  // The close button means every tab. The window asks each document in
  // turn (untitled text asks whether to keep it) and answers; only then
  // does it really close. On Windows and Linux closing the window is how
  // the app quits, so the tabs are remembered for the next launch.
  window.on("close", (event) => {
    if (closeIsConfirmed) return;
    event.preventDefault();
    send("workspace:close-everything", { reason: isQuitting || !isMac ? "quit" : "window" });
  });
  window.on("closed", () => {
    workspaceWindow = null;
    windowIsReady = false;
    settingsWindow?.close();
    if (isQuitting) app.quit();
  });
  return window;
}

function withWindow(action: () => void): void {
  ensureWindow();
  if (windowIsReady) action();
  else whenWindowReady.push(action);
}

function showSettings(): void {
  if (settingsWindow) {
    settingsWindow.focus();
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
    title: strings.t("Settings"),
    parent: workspaceWindow ?? undefined,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1e1e1e" : "#f5f5f7",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  settingsWindow = window;
  window.setMenu(null);
  window.loadURL(`${appOrigin}/renderer/settings.html`);
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    settingsWindow = null;
  });
}

function showAbout(): void {
  const version = `${buildInfo.version} (${buildInfo.gitHash})`;
  if (isWindows) {
    const parent = workspaceWindow ?? undefined;
    const options: Electron.MessageBoxOptions = {
      type: "none",
      title: strings.t("About Lauda"),
      message: "Lauda",
      detail: `${strings.t("Version %@", version)}\n© 2026 Leandro Carneiro`,
      buttons: [strings.t("OK")],
    };
    void (parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options));
  } else {
    app.showAboutPanel();
  }
}

// MARK: - Menus

let menuTimer: NodeJS.Timeout | undefined;
function refreshMenu(): void {
  clearTimeout(menuTimer);
  menuTimer = setTimeout(() => {
    Menu.setApplicationMenu(
      buildMenu({
        strings,
        isMac,
        isWindows,
        recentFiles: recentFiles.list,
        state: menuState,
        send: sendCommand,
        open: () => void showOpenDialog(),
        openRecent: (filePath) => void openFiles([filePath]),
        clearRecent: () => recentFiles.clear(),
        showSettings,
        showWelcomeGuide,
        showAbout,
      }),
    );
  }, 30);
}

function applyAppearance(mode: AppearanceMode): void {
  nativeTheme.themeSource = mode === "auto" ? "system" : mode;
}

// MARK: - Requests from the window

function handle<C extends RequestChannel>(
  channel: C,
  handler: (event: IpcMainInvokeEvent, ...args: Requests[C]["args"]) => Promise<Requests[C]["result"]> | Requests[C]["result"],
): void {
  ipcMain.handle(channel, (event, ...args) => handler(event, ...(args as Requests[C]["args"])));
}

function windowFor(event: IpcMainInvokeEvent): BrowserWindow {
  return BrowserWindow.fromWebContents(event.sender) ?? ensureWindow();
}

const saveFilters = () => [
  { name: strings.t("Markdown Document"), extensions: ["md", "markdown"] },
  { name: strings.t("Plain Text"), extensions: ["txt"] },
];

async function moveFile(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    await copyFile(from, to);
    await rm(from);
  }
}

function registerRequests(): void {
  handle("app:init", (event) => {
    if (event.sender === workspaceWindow?.webContents) {
      setImmediate(() => {
        windowIsReady = true;
        for (const action of whenWindowReady.splice(0)) action();
      });
    }
    return {
      platform: process.platform as "darwin" | "win32" | "linux",
      locale: strings.locale,
      settings: settings.value,
      version: buildInfo.version,
      gitHash: buildInfo.gitHash,
      windowControlsWidth: isMac ? 0 : isWindows ? 138 : 104,
    };
  });
  handle("app:show-settings", () => showSettings());
  handle("app:open-external", (_event, url) => {
    try {
      const scheme = new URL(url).protocol.replace(/:$/, "").toLowerCase();
      if (allowedLinkSchemes.has(scheme)) void shell.openExternal(url);
    } catch {}
  });
  handle("app:list-fonts", () => installedFontFamilies());
  handle("app:read-clipboard", () => clipboard.readText());
  handle("app:open-files", (_event, paths) => openFiles(paths.filter((path) => typeof path === "string")));

  handle("window:set-document", (event, info) => {
    const window = windowFor(event);
    window.setTitle(info.title || "Lauda");
    if (isMac) {
      window.setRepresentedFilename(info.filePath ?? "");
      window.setDocumentEdited(info.edited);
    }
  });
  handle("window:title-bar-double-click", (event) => {
    const window = windowFor(event);
    const action = isMac ? systemPreferences.getUserDefault("AppleActionOnDoubleClick", "string") : "Maximize";
    if (action === "Minimize") window.minimize();
    else if (action !== "None") window.isMaximized() ? window.unmaximize() : window.maximize();
  });
  handle("window:show-menu", (event, x, y) => {
    Menu.getApplicationMenu()?.popup({ window: windowFor(event), x: Math.round(x), y: Math.round(y) });
  });
  handle("window:closed-everything", (_event, ok) => {
    if (!ok) {
      isQuitting = false;
      return;
    }
    closeIsConfirmed = true;
    workspaceWindow?.close();
  });

  handle("doc:register-folder", (_event, documentId, filePath) =>
    registerDocumentFolder(documentId, filePath ? dirname(filePath) : null),
  );
  handle("doc:forget-folder", (_event, documentId) => forgetDocumentFolder(documentId));
  handle("doc:read", async (_event, filePath) => {
    try {
      return { ok: true, text: await readText(filePath) };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  handle("doc:write", async (_event, filePath, text) => {
    try {
      watcher.noteWritten(filePath, text);
      await writeText(filePath, text);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  handle("doc:save-as", async (event, request) => {
    const window = windowFor(event);
    const directory = request.directory ?? app.getPath("documents");
    const name = extname(request.title) ? request.title : `${request.title}.md`;
    const result = await dialog.showSaveDialog(window, {
      defaultPath: join(directory, name),
      filters: saveFilters(),
    });
    if (result.canceled || !result.filePath) return null;
    try {
      watcher.noteWritten(result.filePath, request.text);
      await writeText(result.filePath, request.text);
      recentFiles.note(result.filePath);
      return result.filePath;
    } catch (error) {
      await showError(window, strings.t("Couldn't save “%@”", basename(result.filePath)), error);
      return null;
    }
  });
  handle("doc:rename", async (event, filePath) => {
    const window = windowFor(event);
    const result = await dialog.showSaveDialog(window, {
      title: strings.t("Rename"),
      buttonLabel: strings.t("Rename"),
      defaultPath: filePath,
      filters: saveFilters(),
    });
    if (result.canceled || !result.filePath || result.filePath === filePath) return null;
    try {
      await moveFile(filePath, result.filePath);
      recentFiles.forget(filePath);
      recentFiles.note(result.filePath);
      return result.filePath;
    } catch (error) {
      await showError(window, strings.t("Couldn't rename “%@”", basename(filePath)), error);
      return null;
    }
  });
  handle("doc:move", async (event, filePath) => {
    const window = windowFor(event);
    const result = await dialog.showOpenDialog(window, {
      title: strings.t("Move To…").replace(/…$/, ""),
      buttonLabel: strings.t("Move"),
      defaultPath: dirname(filePath),
      properties: ["openDirectory", "createDirectory"],
    });
    const folder = result.filePaths[0];
    if (result.canceled || !folder || folder === dirname(filePath)) return null;
    const destination = uniqueDestination(basename(filePath), folder);
    try {
      await moveFile(filePath, destination);
      recentFiles.forget(filePath);
      recentFiles.note(destination);
      return destination;
    } catch (error) {
      await showError(window, strings.t("Couldn't move “%@”", basename(filePath)), error);
      return null;
    }
  });
  handle("doc:ask-save-changes", async (event, title) => {
    const result = await dialog.showMessageBox(windowFor(event), {
      type: "warning",
      message: strings.t("Do you want to save the changes you made to “%@”?", title),
      detail: strings.t("Your changes will be lost if you don't save them."),
      buttons: [strings.t("Save…"), strings.t("Don't Save"), strings.t("Cancel")],
      defaultId: 0,
      cancelId: 2,
    });
    return (["save", "dontSave", "cancel"] as const)[result.response] ?? "cancel";
  });
  handle("doc:ask-revert", async (event, title) => {
    const result = await dialog.showMessageBox(windowFor(event), {
      type: "warning",
      message: strings.t("Revert to the last saved version of “%@”?", title),
      detail: strings.t("Your current changes will be lost."),
      buttons: [strings.t("Revert"), strings.t("Cancel")],
      defaultId: 0,
      cancelId: 1,
    });
    return result.response === 0;
  });
  handle("doc:watch", (_event, filePath) => watcher.watch(filePath));
  handle("doc:unwatch", (_event, filePath) => watcher.unwatch(filePath));
  handle("doc:show-error", async (event, message, detail) => {
    await dialog.showMessageBox(windowFor(event), { type: "warning", message, detail, buttons: [strings.t("OK")] });
  });

  handle("session:store", (_event, session) => sessionFile.write(session));

  handle("images:import", (_event, documentPath, files) => importImages(documentPath, files));
  handle("images:save-pasted", (_event, documentPath, png) => savePastedImage(documentPath, png, strings));
  handle("images:ask-save-first", async (event) => {
    await dialog.showMessageBox(windowFor(event), {
      type: "info",
      message: strings.t("Save the document first"),
      detail: strings.t("Images are copied to the document's folder, so save the file before adding images."),
      buttons: [strings.t("OK")],
    });
  });

  handle("export:html", (event, request) => exportHTML(windowFor(event), request, settings.value, strings));
  handle("export:pdf", (event, request) => exportPDF(windowFor(event), request, settings.value, strings));

  handle("settings:set", (_event, changes) => settings.update(changes));
  handle("settings:restore-defaults", () => settings.restoreDefaults());
  /// The Settings window is as tall as its form, as the native one is.
  handle("settings:fit-window", (_event, height) => {
    if (settingsWindow && Number.isFinite(height)) settingsWindow.setContentSize(480, Math.ceil(Math.min(Math.max(height, 200), 900)));
  });

  handle("menu:set-state", (_event, state) => {
    menuState = state;
    refreshMenu();
  });
}

async function showError(window: BrowserWindow, message: string, error: unknown): Promise<void> {
  await dialog.showMessageBox(window, {
    type: "warning",
    message,
    detail: error instanceof Error ? error.message : String(error),
    buttons: [strings.t("OK")],
  });
}

// MARK: - Guarding the pages

/// Nothing navigates away from the app's own pages. The preview frame loads
/// its page once; links open in the browser through the preview's script,
/// never inside the app, and web embeds in a document (https iframes) still
/// load inside the preview.
app.on("web-contents-created", (_event, contents) => {
  // Editable text gets the menu a text view has on a secondary click.
  contents.on("context-menu", (_menuEvent, params) => {
    if (!params.isEditable && !params.selectionText) return;
    const t = strings.t.bind(strings);
    const menu = Menu.buildFromTemplate(
      params.isEditable
        ? [
            { label: t("Cut"), role: "cut", enabled: params.editFlags.canCut },
            { label: t("Copy"), role: "copy", enabled: params.editFlags.canCopy },
            { label: t("Paste"), role: "paste", enabled: params.editFlags.canPaste },
            { type: "separator" },
            { label: t("Select All"), role: "selectAll" },
          ]
        : [{ label: t("Copy"), role: "copy" }],
    );
    const window = BrowserWindow.fromWebContents(contents) ?? workspaceWindow;
    if (window) menu.popup({ window });
  });
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event) => event.preventDefault());
  contents.on("will-frame-navigate", (event) => {
    if (event.isMainFrame) {
      event.preventDefault();
      return;
    }
    const url = event.url;
    if (url.startsWith("lauda-doc://") && url.endsWith("/.lauda-preview")) return;
    const parent = event.frame?.parent;
    if (parent && parent.url.startsWith("lauda-doc://") && url.startsWith("https://")) return;
    if (parent && !parent.url.startsWith(appOrigin) && !parent.url.startsWith("lauda-doc://")) return;
    event.preventDefault();
  });
});

// MARK: - The app's life

app.on("open-file", (event, filePath) => {
  event.preventDefault();
  void openFiles([filePath]);
});

app.on("second-instance", (_event, argv) => {
  const files = filesInArguments(argv);
  if (files.length > 0) void openFiles(files);
  else if (workspaceWindow) {
    if (workspaceWindow.isMinimized()) workspaceWindow.restore();
    workspaceWindow.focus();
  } else void launchWithoutFiles();
});

/// Quitting asks the window first: unsaved untitled text is reviewed and
/// every file is written. The tabs aren't closed as far as the session is
/// concerned, so they come back at the next launch.
app.on("before-quit", (event) => {
  if (!workspaceWindow || closeIsConfirmed) return;
  event.preventDefault();
  isQuitting = true;
  send("workspace:close-everything", { reason: "quit" });
});

app.on("window-all-closed", () => {
  if (!isMac || isQuitting) app.quit();
});

app.on("activate", () => {
  if (!workspaceWindow && isReady) void showOpenDialog();
});

app.whenReady().then(async () => {
  settings = new SettingsStore();
  recentFiles = new RecentFiles();
  const languages = process.env.LAUDA_LOCALE ? [process.env.LAUDA_LOCALE] : app.getPreferredSystemLanguages();
  strings = new Strings(pickLocale(languages), isMac);
  handleProtocols(strings.locale);
  applyAppearance(settings.value.appearanceMode);
  settings.onChange((value) => {
    applyAppearance(value.appearanceMode);
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send("settings:changed", value);
  });
  recentFiles.onChange(refreshMenu);
  nativeTheme.on("updated", () => {
    if (!workspaceWindow) return;
    workspaceWindow.setBackgroundColor(nativeTheme.shouldUseDarkColors ? "#1e1e1e" : "#ffffff");
    if (!isMac) workspaceWindow.setTitleBarOverlay(titleBarOverlay());
  });
  app.setAboutPanelOptions({
    applicationName: "Lauda",
    applicationVersion: buildInfo.version,
    version: buildInfo.gitHash,
    copyright: "© 2026 Leandro Carneiro",
    iconPath: join(distDirectory, "resources/icons/AppIcon-512.png"),
  });
  registerRequests();
  refreshMenu();
  isReady = true;

  const requested = [...filesToOpen.splice(0), ...filesInArguments(process.argv)];
  if (requested.length > 0) await openFiles(requested);
  else await launchWithoutFiles();
});
