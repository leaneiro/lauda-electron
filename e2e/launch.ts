import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface Launched {
  app: ElectronApplication;
  window: Page;
  folder: string;
}

/// Starts the built app with a data folder of its own (so nothing the
/// reader has is touched) and, optionally, files to open.
export async function launch(options: { files?: Record<string, string>; settings?: object; locale?: string } = {}): Promise<Launched> {
  const folder = mkdtempSync(join(tmpdir(), "lauda-e2e-"));
  const userData = join(folder, "user-data");
  const documents = join(folder, "docs");
  require("node:fs").mkdirSync(documents, { recursive: true });
  require("node:fs").mkdirSync(userData, { recursive: true });
  writeFileSync(join(userData, "settings.json"), JSON.stringify({ hasShownWelcomeGuide: true, ...options.settings }));
  const paths = Object.entries(options.files ?? {}).map(([name, text]) => {
    const path = join(documents, name);
    writeFileSync(path, text);
    return path;
  });
  // LAUDA_EXECUTABLE runs the tests against a packaged app instead.
  const executablePath = process.env.LAUDA_EXECUTABLE;
  const app = await electron.launch({
    // The app's own theme, not an emulated one.
    colorScheme: null,
    executablePath,
    args: executablePath ? paths : [".", ...paths],
    env: { ...process.env, LAUDA_USER_DATA: userData, LAUDA_LOCALE: options.locale ?? "en" },
  });
  const window = await app.firstWindow();
  await window.waitForSelector("#titlebar");
  return { app, window, folder: documents };
}

/// The preview's frame, once its page has loaded.
export async function previewFrame(window: Page, index = 0) {
  await window.waitForFunction((i) => document.querySelectorAll(".document:not([hidden]) .preview-frame").length > i, index);
  const handle = await window.locator(".document:not([hidden]) .preview-frame").nth(index).elementHandle();
  const frame = await handle!.contentFrame();
  await frame!.waitForSelector("#content");
  return frame!;
}

/// Clicks a menu item by its labels, as the reader would. Keys pressed
/// through the page never reach the system's menus, so a test can't use a
/// menu's shortcut; this goes through the same items.
export async function clickMenu(app: ElectronApplication, ...path: string[]): Promise<void> {
  await app.evaluate(({ Menu, BrowserWindow }, path) => {
    let items = Menu.getApplicationMenu()?.items ?? [];
    let item: Electron.MenuItem | undefined;
    for (const label of path) {
      item = items.find((candidate) => candidate.label === label);
      if (!item) throw new Error(`No menu item ${label}`);
      items = item.submenu?.items ?? [];
    }
    item?.click(undefined, BrowserWindow.getAllWindows()[0], undefined as never);
  }, path);
}

/// Ends the app at once, whatever it still asks about.
export async function forceQuit(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
}
