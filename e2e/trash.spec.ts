import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ElectronApplication, expect, type Page, test } from "@playwright/test";
import { clickMenu, forceQuit, type Launched, launch } from "./launch";

/// The Trash rule (features/F01, TRASH-01) through the app's window: a file
/// moved into a folder that stands for the Trash, as the file manager
/// would, and back, or deleted from there.

interface Scene extends Launched {
  home: string;
  trashed: string;
}

async function open(text = "draft", others: Record<string, string> = {}): Promise<Scene> {
  const launched = await launch({ files: { "notes.md": text, ...others } });
  // A text of one line, so a click in the editor and End put the caret
  // after its last letter.
  await launched.window.locator(".document:not([hidden]) .cm-content").waitFor();
  return {
    ...launched,
    home: join(launched.folder, "notes.md"),
    trashed: join(launched.trash, "notes.md"),
  };
}

const notice = (window: Page) => window.locator(".document:not([hidden]) .trash-notice");
const editor = (window: Page) => window.locator(".document:not([hidden]) .cm-content");

async function throwAway(scene: Scene): Promise<void> {
  renameSync(scene.home, scene.trashed);
  await expect(notice(scene.window)).toBeVisible();
}

async function putBack(scene: Scene): Promise<void> {
  renameSync(scene.trashed, scene.home);
  await expect(notice(scene.window)).toBeHidden();
}

/// Types into the editor and throws the file away before the autosave: the
/// edit the document keeps while the file is in the Trash.
async function throwAwayWithAnEditKept(scene: Scene): Promise<void> {
  await editor(scene.window).click();
  await scene.window.keyboard.press("End");
  await scene.window.keyboard.type("x");
  await throwAway(scene);
}

/// Every message box answers with `response`, and what it asked is kept.
async function answerQuestions(app: ElectronApplication, response: number): Promise<void> {
  await app.evaluate(({ dialog }, response) => {
    const kept = globalThis as { asked?: string[] };
    kept.asked = [];
    dialog.showMessageBox = (async (_window: unknown, options: Electron.MessageBoxOptions) => {
      kept.asked?.push(options.message);
      return { response, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
  }, response);
}

function asked(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => (globalThis as { asked?: string[] }).asked ?? []);
}

test("TRASH-01.1 TRASH-01.3 TRASH-01.4 TRASH-01.7 the file in the Trash shows the notice and takes no typing", async () => {
  const scene = await open();
  await editor(scene.window).click();
  await throwAway(scene);

  await expect(notice(scene.window)).toContainText("This file is in the Trash");
  await expect(notice(scene.window)).toContainText("Put it back to keep editing.");
  await expect(editor(scene.window)).toHaveAttribute("contenteditable", "false");
  expect(await notice(scene.window).evaluate((element) => getComputedStyle(element).cursor)).toBe("default");
  // The keyboard left the editor, and a key goes nowhere.
  expect(await scene.window.evaluate(() => document.activeElement?.closest(".panes .cm-editor") === null)).toBe(true);
  await scene.window.keyboard.type("x");
  await clickMenu(scene.app, "File", "Save");
  await clickMenu(scene.app, "Format", "Bold");
  await expect(editor(scene.window)).toHaveText("draft");
  expect(readFileSync(scene.trashed, "utf8")).toBe("draft");
  await scene.app.close();
});

test("TRASH-01.4 an open find bar closes, and Find opens nothing while the file is in the Trash", async () => {
  const scene = await open();
  await clickMenu(scene.app, "Edit", "Find…");
  const findBar = scene.window.locator(".document:not([hidden]) .find-bar");
  await expect(findBar).toBeVisible();
  await throwAway(scene);
  await expect(findBar).toBeHidden();
  await clickMenu(scene.app, "Edit", "Find…");
  await expect(findBar).toBeHidden();
  await scene.app.close();
});

test("TRASH-01.6 put back, the file is read again and takes typing", async () => {
  const scene = await open();
  await throwAway(scene);
  writeFileSync(scene.trashed, "final");
  await putBack(scene);
  await expect(editor(scene.window)).toHaveText("final");
  await editor(scene.window).click();
  await scene.window.keyboard.press("End");
  await scene.window.keyboard.type("x");
  await expect(editor(scene.window)).toHaveText("finalx");
  await scene.app.close();
});

test("TRASH-01.10 TRASH-01.11 an edit kept out of the Trash is saved once the file is back", async () => {
  const scene = await open();
  await throwAwayWithAnEditKept(scene);
  await clickMenu(scene.app, "File", "Save");
  await scene.window.waitForTimeout(2500);
  expect(readFileSync(scene.trashed, "utf8")).toBe("draft");

  await putBack(scene);
  await expect.poll(() => readFileSync(scene.home, "utf8")).toBe("draftx");
  await scene.app.close();
});

test("TRASH-01.5 another tab takes typing beside a file in the Trash", async () => {
  const scene = await open("draft", { "other.md": "other" });
  await scene.window.locator(".tab", { hasText: "notes.md" }).click();
  await throwAway(scene);
  await scene.window.locator(".tab", { hasText: "other.md" }).click();
  await editor(scene.window).click();
  await scene.window.keyboard.press("End");
  await scene.window.keyboard.type("x");
  await expect(editor(scene.window)).toHaveText("otherx");
  await scene.app.close();
});

test("TRASH-01.9 Show in Trash shows the file where it is in the Trash", async () => {
  const scene = await open();
  await scene.app.evaluate(({ shell }) => {
    shell.showItemInFolder = (path: string) => {
      (globalThis as { shown?: string }).shown = path;
    };
  });
  await throwAway(scene);
  await notice(scene.window).getByRole("button", { name: "Show in Trash" }).click();
  await expect.poll(() => scene.app.evaluate(() => (globalThis as { shown?: string }).shown)).toBe(scene.trashed);
  await expect(notice(scene.window)).toBeVisible();
  await scene.app.close();
});

test("TRASH-01.12 closing with an edit kept asks first, and Cancel keeps the tab", async () => {
  const scene = await open();
  await throwAwayWithAnEditKept(scene);
  await answerQuestions(scene.app, 1);
  await clickMenu(scene.app, "File", "Close");
  await expect.poll(() => asked(scene.app)).toEqual(["Close “notes.md” without saving?"]);
  await expect(notice(scene.window)).toBeVisible();

  await answerQuestions(scene.app, 0);
  // Close loses the edit and closes the last tab, and with it the window
  // and the app.
  const quit = scene.app.waitForEvent("close");
  await clickMenu(scene.app, "File", "Close");
  await quit;
  expect(readFileSync(scene.trashed, "utf8")).toBe("draft");
});

test("TRASH-01.5 closing with nothing unsaved asks nothing while the file is in the Trash", async () => {
  const scene = await open("draft", { "other.md": "other" });
  await scene.window.locator(".tab", { hasText: "notes.md" }).click();
  await throwAway(scene);
  await answerQuestions(scene.app, 1);
  await clickMenu(scene.app, "File", "Close");
  await expect(scene.window.locator(".tab")).toHaveCount(0);
  await expect(scene.window.locator(".window-title")).toHaveText("other.md");
  expect(await asked(scene.app)).toEqual([]);
  await scene.app.close();
});

test("TRASH-01.13 put back changed, with an edit kept, asks, and Use the File reads it", async () => {
  const scene = await open();
  await throwAwayWithAnEditKept(scene);
  writeFileSync(scene.trashed, "final");
  await answerQuestions(scene.app, 1);
  await putBack(scene);
  await expect.poll(() => asked(scene.app)).toEqual(["“notes.md” changed while it was in the Trash"]);
  await expect(editor(scene.window)).toHaveText("final");
  expect(readFileSync(scene.home, "utf8")).toBe("final");
  await scene.app.close();
});

test("TRASH-01.13 Keep My Changes writes the text kept over the file", async () => {
  const scene = await open();
  await throwAwayWithAnEditKept(scene);
  writeFileSync(scene.trashed, "final");
  await answerQuestions(scene.app, 0);
  await putBack(scene);
  await expect.poll(() => readFileSync(scene.home, "utf8")).toBe("draftx");
  await expect(editor(scene.window)).toHaveText("draftx");
  await scene.app.close();
});

test("TRASH-01.14 the file deleted from the Trash closes its tab without a question", async () => {
  const scene = await open("draft", { "other.md": "other" });
  await scene.window.locator(".tab", { hasText: "notes.md" }).click();
  await throwAway(scene);
  await answerQuestions(scene.app, 1);
  rmSync(scene.trashed);
  await expect(scene.window.locator(".tab")).toHaveCount(0);
  await expect(scene.window.locator(".window-title")).toHaveText("other.md");
  expect(await asked(scene.app)).toEqual([]);
  await scene.app.close();
});

test("TRASH-01.15 the file deleted from the Trash with an edit kept leaves an untitled document", async () => {
  const scene = await open();
  await throwAwayWithAnEditKept(scene);
  rmSync(scene.trashed);
  await expect(notice(scene.window)).toBeHidden();
  await expect(scene.window.locator(".window-title")).toHaveText("Untitled");
  await expect(editor(scene.window)).toHaveText("draftx");
  await editor(scene.window).click();
  await scene.window.keyboard.press("End");
  await scene.window.keyboard.type("y");
  await expect(editor(scene.window)).toHaveText("draftxy");
  await forceQuit(scene.app);
});

test("TRASH-01.16 the file deleted while the closing question is up takes it down as Cancel", async () => {
  const scene = await open();
  await throwAwayWithAnEditKept(scene);
  await scene.app.evaluate(({ dialog }) => {
    const kept = globalThis as { asked?: string[] };
    kept.asked = [];
    dialog.showMessageBox = ((_window: unknown, options: Electron.MessageBoxOptions) => {
      kept.asked?.push(options.message);
      return new Promise((resolve) =>
        options.signal?.addEventListener("abort", () =>
          resolve({ response: options.cancelId ?? 0, checkboxChecked: false }),
        ),
      );
    }) as typeof dialog.showMessageBox;
  });
  await clickMenu(scene.app, "File", "Close");
  await expect.poll(() => asked(scene.app)).toHaveLength(1);
  rmSync(scene.trashed);
  await expect(scene.window.locator(".window-title")).toHaveText("Untitled");
  await expect(editor(scene.window)).toHaveText("draftx");
  await forceQuit(scene.app);
});

test("TRASH-01.8 a file renamed in its folder is followed, and typing saves under the new name", async () => {
  const scene = await open();
  const renamed = join(scene.folder, "ideas.md");
  renameSync(scene.home, renamed);
  await expect(scene.window.locator(".window-title")).toHaveText("ideas.md");
  await expect(notice(scene.window)).toBeHidden();
  await editor(scene.window).click();
  await scene.window.keyboard.press("End");
  await scene.window.keyboard.type("x");
  await expect.poll(() => readFileSync(renamed, "utf8"), { timeout: 6000 }).toBe("draftx");
  expect(existsSync(scene.home)).toBe(false);
  await scene.app.close();
});
