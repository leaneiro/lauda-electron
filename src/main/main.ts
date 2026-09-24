import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  type IpcMainInvokeEvent,
  Menu,
  nativeTheme,
  session,
  shell,
  systemPreferences,
} from "electron";
import { withCtrlShortcuts } from "../shared/document";
import { pickLocale, Strings } from "../shared/i18n";
import type { Events, MenuCommand, MenuState, OpenDocument } from "../shared/ipc";
import { allowedLinkSchemes } from "../shared/markdown";
import type { AppearanceMode } from "../shared/settings";
import { showError } from "./dialogs";
import { exportHTML, exportPDF } from "./export";
import { DocumentWatcher, readText } from "./files";
import { GrantedFiles, isOpenableByPath } from "./granted-files";
import { logProcessesGone, logWindowFailure } from "./log";
import { buildMenu } from "./menu";
import { guardPages } from "./navigation";
import { appOrigin, distDirectory, handleProtocols, registerSchemes } from "./protocols";
import { registerDocumentRequests } from "./requests/documents";
import { handle } from "./requests/handle";
import { RecentFiles, readSession, SettingsStore } from "./store";
import { DocumentWindow, SettingsWindow } from "./windows";

const isMac = process.platform === "darwin";
const isWindows = process.platform === "win32";

// On a Mac this build only runs next to the native app, which must not see
// its settings or window state change. Tests bring a folder of their own.
if (process.env.LAUDA_USER_DATA) app.setPath("userData", process.env.LAUDA_USER_DATA);
else if (isMac) app.setPath("userData", join(app.getPath("appData"), "Lauda Electron"));
app.setName("Lauda");
registerSchemes();

// Every page the app opens runs sandboxed, whatever its window says; the
// windows say so too, but a new one can't forget.
app.enableSandbox();
logProcessesGone();

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
/// Set once the window's page answered app:init; opening waits for it.
/// Files asked for before the app was ready (the Finder, the command line).
const filesToOpen: string[] = [];
let isReady = false;
let menuState: MenuState = { hasDocument: false, hasFile: false, documentCount: 0, viewMode: "split" };

/// The document window and its life (DocumentWindow), and Settings.
const documentWindow = new DocumentWindow(() => settingsWindow.close());
const settingsWindow = new SettingsWindow({ title: () => strings.t("Settings"), parent: () => documentWindow.current });

const watcher = new DocumentWatcher((filePath, text) => send("doc:changed-on-disk", { filePath, text }));
/// The files this process has handed the window, the only ones it may
/// write to, move or watch (see GrantedFiles).
const granted = new GrantedFiles();

function send<C extends keyof Events>(channel: C, payload: Events[C]): void {
  documentWindow.send(channel, payload);
}

function sendCommand(command: MenuCommand): void {
  withWindow(() => send("menu:command", command));
}

// MARK: - Opening

/// What File > Open offers as Markdown, what a drop may open, and what the
/// app claims on the system (package.json's fileAssociations lists the
/// same first six, the ones that only Markdown uses).
const markdownOnlyExtensions = ["md", "markdown", "mdown", "mkd", "mkdn", "mdwn", "mdtxt", "mdtext"];
const plainTextExtensions = ["txt", "text"];
const markdownExtensions = [...markdownOnlyExtensions, ...plainTextExtensions];

/// Opens the files one after another, so their tabs keep this order
/// whatever each one takes to read. A file already open comes forward.
async function openFiles(paths: string[], select?: string | null): Promise<void> {
  if (!isReady) {
    filesToOpen.push(...paths);
    return;
  }
  const window = documentWindow.ensure();
  for (const filePath of paths) {
    try {
      const text = await readText(filePath);
      recentFiles.note(filePath);
      granted.grant(filePath);
      withWindow(() => send("workspace:open", { filePath, text }));
    } catch (error) {
      recentFiles.forget(filePath);
      await showError(window, strings.t("Couldn't open “%@”", basename(filePath)), error, strings);
    }
  }
  // Its own event, not an open with no text: a file that failed to open
  // above has no tab, and an empty document tied to its path would be
  // written over it at the first key.
  if (select && paths.includes(select)) {
    withWindow(() => send("workspace:select", { filePath: select }));
  }
}

async function showOpenDialog(): Promise<void> {
  const options: Electron.OpenDialogOptions = {
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: strings.t("Markdown Document"), extensions: markdownOnlyExtensions },
      { name: strings.t("Plain Text"), extensions: plainTextExtensions },
      { name: strings.t("All Files"), extensions: ["*"] },
    ],
  };
  const parent = documentWindow.current;
  const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
  if (!result.canceled) await openFiles(result.filePaths);
}

/// The system the app is dressed for. LAUDA_PLATFORM stands in for another
/// one while developing, to see what it will look like there.
function targetPlatform(): "darwin" | "win32" | "linux" {
  return (process.env.LAUDA_PLATFORM ?? process.platform) as "darwin" | "win32" | "linux";
}

function welcomeGuideText(): string {
  const tryRead = (language: string) => {
    try {
      return readFileSync(join(distDirectory, "resources/welcome", `${language}.md`), "utf8");
    } catch {
      return null;
    }
  };
  const guide = tryRead(strings.locale) ?? tryRead("en") ?? "";
  // The guide comes from the native app, written with the Mac's keys; here
  // it is read with the keys of the menus around it.
  return targetPlatform() === "darwin" ? guide : withCtrlShortcuts(guide);
}

/// The guide opens as an untitled document holding its text, so people can
/// experiment freely and save it only if they want to. `delivered` runs once
/// the page has it.
function showWelcomeGuide(delivered?: () => void): void {
  documentWindow.ensure();
  const document: OpenDocument = { filePath: null, text: welcomeGuideText(), title: strings.t("Welcome") };
  withWindow(() => {
    send("workspace:open", document);
    delivered?.();
  });
}

/// A launch with nothing to open: the guide the first time, then the tabs
/// left open last time. With neither, the Mac offers to open something, as
/// the native app does; Windows and Linux start a new document instead,
/// since a Save dialog with no window reads as the app failing to start.
async function launchWithoutFiles(): Promise<void> {
  if (!settings.value.hasShownWelcomeGuide) {
    // Shown once the page has it: a launch that never got that far (a
    // window an earlier build left hidden) leaves the guide for the next.
    showWelcomeGuide(() => settings.update({ hasShownWelcomeGuide: true }));
    return;
  }
  const session = readSession();
  const existing = session.files.filter((file) => existsSync(file));
  if (existing.length > 0) {
    await openFiles(existing, session.selected);
  } else if (isMac) {
    await showOpenDialog();
  } else {
    documentWindow.ensure();
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

function withWindow(action: () => void): void {
  documentWindow.whenReady(action);
}

function showAbout(): void {
  const version = `${buildInfo.version} (${buildInfo.gitHash})`;
  if (isWindows) {
    const parent = documentWindow.current ?? undefined;
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
        showSettings: () => settingsWindow.show(),
        showWelcomeGuide: () => showWelcomeGuide(),
        showAbout,
      }),
    );
  }, 30);
}

/// The app asks the web for no permission at all (the clipboard, files and
/// fonts go through this process), and the preview shows frames and images
/// from the network, which may ask. Electron grants what nobody decides
/// on, so the decision is written down: no.
function denyWebPermissions(): void {
  // One exception: the app's own pages may list the installed fonts, which
  // the Settings window's pickers show. A document's preview, of an origin
  // of its own, may not.
  const allowed = (permission: string, origin: string) => permission === "local-fonts" && origin === `${appOrigin}/`;
  session.defaultSession.setPermissionRequestHandler((_contents, permission, answer, details) =>
    answer(allowed(permission, `${URL.parse(details.requestingUrl)?.origin}/`)),
  );
  session.defaultSession.setPermissionCheckHandler((_contents, permission, origin) => allowed(permission, origin));
}

function applyAppearance(mode: AppearanceMode): void {
  nativeTheme.themeSource = mode === "auto" ? "system" : mode;
}

// MARK: - Requests from the window

function windowFor(event: IpcMainInvokeEvent): BrowserWindow {
  return BrowserWindow.fromWebContents(event.sender) ?? documentWindow.ensure();
}

function registerRequests(): void {
  handle("app:init", (event) => {
    documentWindow.pageAskedForState(event.sender);
    // LAUDA_PLATFORM lays the window out as on another system, to look at
    // its title bar while developing; the menus and dialogs stay this one's.
    const platform = targetPlatform();
    return {
      platform,
      locale: strings.locale,
      settings: settings.value,
      version: buildInfo.version,
      gitHash: buildInfo.gitHash,
      windowControlsWidth: platform === "darwin" ? 0 : platform === "win32" ? 138 : 104,
    };
  });
  handle("app:open-external", (_event, url) => {
    try {
      const scheme = new URL(url).protocol.replace(/:$/, "").toLowerCase();
      if (allowedLinkSchemes.has(scheme)) void shell.openExternal(url);
    } catch {
      // A link that isn't a URL goes nowhere, as a click on it should.
    }
  });
  handle("app:read-clipboard", () => clipboard.readText());
  handle("app:log-failure", (_event, what, kind) => logWindowFailure(what, kind));
  handle("app:open-files", (_event, paths) =>
    openFiles(paths.filter((path) => isOpenableByPath(path, markdownExtensions))),
  );

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
  handle("window:closed-everything", (_event, ok) => documentWindow.everythingClosed(ok));
  handle("window:close", (event) => windowFor(event).close());

  registerDocumentRequests({ granted, watcher, recentFiles, strings, windowFor });

  handle("export:html", (event, request) => exportHTML(windowFor(event), request, settings.value, strings));
  handle("export:pdf", (event, request) => exportPDF(windowFor(event), request, settings.value, strings));

  handle("settings:set", (_event, changes) => settings.update(changes));
  handle("settings:restore-defaults", () => settings.restoreDefaults());
  /// The Settings window is as tall as its form, as the native one is.
  handle("settings:fit-window", (_event, height) => {
    settingsWindow.fitContent(height);
  });

  handle("menu:set-state", (_event, state) => {
    menuState = state;
    refreshMenu();
  });
}

// MARK: - Guarding the pages

guardPages(app, { strings: () => strings, window: () => documentWindow.current });

// MARK: - The app's life

app.on("open-file", (event, filePath) => {
  event.preventDefault();
  void openFiles([filePath]);
});

app.on("second-instance", (_event, argv) => {
  const files = filesInArguments(argv);
  if (files.length > 0) void openFiles(files);
  else if (!documentWindow.bringForward()) void launchWithoutFiles();
});

/// Quitting asks the window first: unsaved untitled text is reviewed and
/// every file is written. The tabs aren't closed as far as the session is
/// concerned, so they come back at the next launch.
app.on("before-quit", (event) => {
  if (documentWindow.askToQuit()) event.preventDefault();
});

app.on("will-quit", () => {
  if (isReady) settings.flush();
});

app.on("window-all-closed", () => {
  if (!isMac || documentWindow.isQuitting) app.quit();
});

app.on("activate", () => {
  if (!documentWindow.current && isReady) void showOpenDialog();
});

app.whenReady().then(async () => {
  settings = new SettingsStore();
  recentFiles = new RecentFiles();
  const languages = process.env.LAUDA_LOCALE ? [process.env.LAUDA_LOCALE] : app.getPreferredSystemLanguages();
  strings = new Strings(pickLocale(languages), isMac);
  handleProtocols(strings.locale);
  denyWebPermissions();
  applyAppearance(settings.value.appearanceMode);
  settings.onChange((value) => {
    applyAppearance(value.appearanceMode);
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send("settings:changed", value);
  });
  recentFiles.onChange(refreshMenu);
  nativeTheme.on("updated", () => {
    documentWindow.themeChanged();
  });
  app.setAboutPanelOptions({
    applicationName: "Lauda",
    // Only the Mac's panel shows `version`; elsewhere the commit goes with the
    // version, as the Windows dialog writes it.
    applicationVersion: isMac ? buildInfo.version : `${buildInfo.version} (${buildInfo.gitHash})`,
    version: buildInfo.gitHash,
    copyright: "© 2026 Leandro Carneiro",
    // Linux's panel reads the icon with GTK, which can't look inside the
    // app's archive: the packaged app keeps a copy beside it.
    iconPath: app.isPackaged
      ? join(process.resourcesPath, "AppIcon-512.png")
      : join(distDirectory, "resources/icons/AppIcon-512.png"),
  });
  registerRequests();
  refreshMenu();
  isReady = true;

  const requested = [...filesToOpen.splice(0), ...filesInArguments(process.argv)];
  if (requested.length > 0) await openFiles(requested);
  else await launchWithoutFiles();
});
