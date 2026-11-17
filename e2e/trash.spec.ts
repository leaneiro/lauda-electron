import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
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

test("TRASH-01.1 a new document saved somewhere is followed to the Trash as an opened one is", async () => {
  const scene = await open();
  const saved = join(scene.folder, "new.md");
  await scene.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send("menu:command", { name: "new" });
  });
  await expect(scene.window.locator(".tab")).toHaveCount(2);
  await editor(scene.window).click();
  await scene.window.keyboard.type("fresh");
  await scene.app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog;
  }, saved);
  await clickMenu(scene.app, "File", "Save");
  await expect(scene.window.locator(".tab.is-selected .tab-title")).toHaveText("new.md");

  renameSync(saved, join(scene.trash, "new.md"));
  await expect(notice(scene.window)).toBeVisible();
  await scene.window.keyboard.type("x");
  await scene.window.waitForTimeout(2500);
  // Nothing made again where it was.
  expect(existsSync(saved)).toBe(false);
  await scene.app.close();
});

const selectedTab = (window: Page) => window.locator(".tab.is-selected .tab-title");

/// The notice is a translucent veil over the text: how much of the editor it
/// covers and how opaque it is, as the reader sees them.
function veilOver(window: Page): Promise<{ covers: boolean; alpha: number }> {
  return window.evaluate(() => {
    const veil = document.querySelector(".document:not([hidden]) .trash-notice");
    const text = document.querySelector(".document:not([hidden]) .cm-content");
    if (!veil || !text) return { covers: false, alpha: 0 };
    const a = veil.getBoundingClientRect();
    const b = text.getBoundingClientRect();
    const background = getComputedStyle(veil).backgroundColor;
    const alpha = Number(/\/\s*([\d.]+)\)|,\s*([\d.]+)\)$/.exec(background)?.slice(1).find(Boolean) ?? 1);
    const covers =
      a.left <= b.left && a.top <= b.top && a.right >= b.right && a.bottom >= Math.min(b.bottom, b.top + 20);
    return { covers, alpha };
  });
}

async function showTab(scene: Scene, name: string): Promise<void> {
  await scene.window.locator(".tab", { hasText: name }).click();
  await expect(selectedTab(scene.window)).toHaveText(name);
}

test("TRASH-01.1 in a tab, the notice is on the trashed tab and not on the other", async () => {
  const scene = await open("draft", { "other.md": "other" });
  await showTab(scene, "notes.md");
  await throwAway(scene);
  await expect(notice(scene.window)).toContainText("This file is in the Trash");
  await showTab(scene, "other.md");
  await expect(notice(scene.window)).toBeHidden();
  await scene.app.close();
});

test("TRASH-01.2 the notice cannot be dismissed by a click, Esc or a tab switch", async () => {
  const scene = await open("draft", { "other.md": "other" });
  await showTab(scene, "notes.md");
  await throwAway(scene);
  await notice(scene.window).click();
  await expect(notice(scene.window)).toBeVisible();
  await scene.window.keyboard.press("Escape");
  await expect(notice(scene.window)).toBeVisible();
  await showTab(scene, "other.md");
  await showTab(scene, "notes.md");
  await expect(notice(scene.window)).toBeVisible();
  await scene.app.close();
});

test("TRASH-01.3 the text of the file in the Trash is veiled, the text of the others is not", async () => {
  const scene = await open("draft", { "other.md": "other" });
  await showTab(scene, "notes.md");
  await throwAway(scene);
  const veil = await veilOver(scene.window);
  expect(veil.covers).toBe(true);
  expect(veil.alpha).toBeGreaterThan(0);
  expect(veil.alpha).toBeLessThan(1);
  await showTab(scene, "other.md");
  await expect(notice(scene.window)).toBeHidden();
  await scene.app.close();
});

test("TRASH-01.4 paste, cut and undo change nothing while the file is in the Trash", async () => {
  const scene = await open();
  await editor(scene.window).click();
  await scene.window.keyboard.press("End");
  await scene.window.keyboard.type("x");
  await expect.poll(() => readFileSync(scene.home, "utf8"), { timeout: 6000 }).toBe("draftx");
  await throwAway(scene);
  await scene.app.evaluate(({ clipboard }) => clipboard.writeText("PASTED"));
  for (const item of ["Paste", "Cut", "Undo"]) {
    await clickMenu(scene.app, "Edit", item);
  }
  await expect(editor(scene.window)).toHaveText("draftx");
  await scene.window.waitForTimeout(2500);
  expect(readFileSync(scene.trashed, "utf8")).toBe("draftx");
  await scene.app.close();
});

test("TRASH-01.5 another file opens and takes typing while a file is in the Trash", async () => {
  const scene = await open();
  const third = join(scene.folder, "third.md");
  writeFileSync(third, "third");
  await throwAway(scene);
  await scene.app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog;
  }, third);
  await clickMenu(scene.app, "File", "Open…");
  await expect(scene.window.locator(".tab")).toHaveCount(2);
  await expect(selectedTab(scene.window)).toHaveText("third.md");
  await editor(scene.window).click();
  await scene.window.keyboard.press("End");
  await scene.window.keyboard.type("x");
  await expect(editor(scene.window)).toHaveText("thirdx");
  await scene.app.close();
});

test("TRASH-01.6 put back with no edit kept brings the aspect and the cursor back and writes nothing", async () => {
  const scene = await open();
  await throwAway(scene);
  await scene.window.waitForTimeout(500);
  await putBack(scene);
  await expect(editor(scene.window)).toHaveAttribute("contenteditable", "true");
  await expect(editor(scene.window)).toHaveText("draft");
  await scene.window.waitForTimeout(2500);
  expect(readFileSync(scene.home, "utf8")).toBe("draft");
  await scene.app.close();
});

test("TRASH-01.7 the arrow is the cursor over the dimmed text", async () => {
  const scene = await open();
  await throwAway(scene);
  const box = await editor(scene.window).boundingBox();
  const cursorAt = await scene.window.evaluate(
    ([x, y]) => {
      const element = document.elementFromPoint(x as number, y as number);
      return element ? getComputedStyle(element).cursor : "none";
    },
    [(box?.x ?? 0) + 5, (box?.y ?? 0) + 5],
  );
  expect(cursorAt).toBe("default");
  await putBack(scene);
  const pointed = await scene.window.evaluate(
    ([x, y]) => document.elementFromPoint(x as number, y as number)?.closest(".cm-content") !== null,
    [(box?.x ?? 0) + 5, (box?.y ?? 0) + 5],
  );
  expect(pointed).toBe(true);
  await scene.app.close();
});

test("TRASH-01.8 a file renamed in its folder, in a tab, is followed with no notice", async () => {
  const scene = await open("draft", { "other.md": "other" });
  await showTab(scene, "notes.md");
  const renamed = join(scene.folder, "ideas.md");
  renameSync(scene.home, renamed);
  await expect(selectedTab(scene.window)).toHaveText("ideas.md");
  await expect(notice(scene.window)).toBeHidden();
  await editor(scene.window).click();
  await scene.window.keyboard.press("End");
  await scene.window.keyboard.type("x");
  await expect.poll(() => readFileSync(renamed, "utf8"), { timeout: 6000 }).toBe("draftx");
  await scene.app.close();
});

test("TRASH-01.8 a file moved to another folder is not followed: no notice, and it saves where it was", async () => {
  const scene = await open();
  const desk = join(scene.folder, "..", "desk");
  mkdirSync(desk, { recursive: true });
  renameSync(scene.home, join(desk, "notes.md"));
  await scene.window.waitForTimeout(1500);
  await expect(notice(scene.window)).toBeHidden();
  await expect(scene.window.locator(".window-title")).toHaveText("notes.md");
  await editor(scene.window).click();
  await scene.window.keyboard.press("End");
  await scene.window.keyboard.type("x");
  await expect.poll(() => existsSync(scene.home) && readFileSync(scene.home, "utf8"), { timeout: 6000 }).toBe("draftx");
  expect(readFileSync(join(desk, "notes.md"), "utf8")).toBe("draft");
  await scene.app.close();
});

test("TRASH-01.9 Show in Trash is in the notice and goes with it when the file is back", async () => {
  const scene = await open();
  await throwAway(scene);
  await expect(notice(scene.window).getByRole("button", { name: "Show in Trash" })).toBeVisible();
  await putBack(scene);
  await expect(scene.window.getByRole("button", { name: "Show in Trash" })).toHaveCount(0);
  await scene.app.close();
});

test("TRASH-01.10 a file already saved when thrown away keeps no edit, and the Trash file stays as it was", async () => {
  const scene = await open();
  await throwAway(scene);
  await answerQuestions(scene.app, 1);
  await clickMenu(scene.app, "File", "Close");
  expect(await asked(scene.app)).toEqual([]);
  expect(readFileSync(scene.trashed, "utf8")).toBe("draft");
  await scene.app.close().catch(() => {});
});

test("TRASH-01.10 the edit kept shows in the dimmed text and stays out of the file", async () => {
  const scene = await open();
  await throwAwayWithAnEditKept(scene);
  await expect(editor(scene.window)).toHaveText("draftx");
  expect((await veilOver(scene.window)).covers).toBe(true);
  expect(readFileSync(scene.trashed, "utf8")).toBe("draft");
  await forceQuit(scene.app);
});

test("TRASH-01.11 put back with no edit kept does not write the file", async () => {
  const scene = await open();
  await throwAway(scene);
  const before = statSync(scene.trashed).mtimeMs;
  await putBack(scene);
  await scene.window.waitForTimeout(2500);
  expect(readFileSync(scene.home, "utf8")).toBe("draft");
  expect(statSync(scene.home).mtimeMs).toBe(before);
  await scene.app.close();
});

test("TRASH-01.11 put back unchanged with an edit kept shows the edit and asks nothing", async () => {
  const scene = await open();
  await throwAwayWithAnEditKept(scene);
  await answerQuestions(scene.app, 1);
  await putBack(scene);
  await expect(editor(scene.window)).toHaveText("draftx");
  await expect.poll(() => readFileSync(scene.home, "utf8")).toBe("draftx");
  expect(await asked(scene.app)).toEqual([]);
  await scene.app.close();
});

test("TRASH-01.12 the sheet has the text and the two buttons", async () => {
  const scene = await open();
  await throwAwayWithAnEditKept(scene);
  await scene.app.evaluate(({ dialog }) => {
    const kept = globalThis as { sheet?: Electron.MessageBoxOptions };
    dialog.showMessageBox = (async (_window: unknown, options: Electron.MessageBoxOptions) => {
      kept.sheet = options;
      return { response: 1, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
  });
  await clickMenu(scene.app, "File", "Close");
  await expect.poll(() => scene.app.evaluate(() => (globalThis as { sheet?: unknown }).sheet !== undefined)).toBe(true);
  const sheet = await scene.app.evaluate(() => (globalThis as { sheet?: Electron.MessageBoxOptions }).sheet);
  expect(sheet?.message).toBe("Close “notes.md” without saving?");
  expect(sheet?.detail).toBe("The file is in the Trash, so your changes can't be saved. Put it back to keep them.");
  expect(sheet?.buttons).toEqual(["Close", "Cancel"]);
  await forceQuit(scene.app);
});

test("TRASH-01.12 quitting with another tab in front brings the trashed tab forward, and Cancel keeps the app", async () => {
  const scene = await open("draft", { "other.md": "other" });
  await showTab(scene, "notes.md");
  await throwAwayWithAnEditKept(scene);
  await showTab(scene, "other.md");
  await answerQuestions(scene.app, 1);
  await scene.app.evaluate(({ app }) => app.quit());
  await expect.poll(() => asked(scene.app)).toEqual(["Close “notes.md” without saving?"]);
  await expect(selectedTab(scene.window)).toHaveText("notes.md");
  await expect(notice(scene.window)).toBeVisible();
  expect(await scene.app.evaluate(({ app }) => app.isReady())).toBe(true);
  await forceQuit(scene.app);
});

test("TRASH-01.12 closing without an edit kept asks nothing", async () => {
  const scene = await open("draft", { "other.md": "other" });
  await showTab(scene, "notes.md");
  await throwAway(scene);
  await answerQuestions(scene.app, 1);
  await scene.app.evaluate(({ app }) => app.quit()).catch(() => {});
  await scene.app.waitForEvent("close").catch(() => {});
  expect(await asked(scene.app).catch(() => [])).toEqual([]);
});

test("TRASH-01.13 the sheet has the text and buttons, and nothing is written before the answer", async () => {
  const scene = await open();
  await throwAwayWithAnEditKept(scene);
  writeFileSync(scene.trashed, "final");
  await scene.app.evaluate(({ dialog }) => {
    const kept = globalThis as { sheet?: Electron.MessageBoxOptions };
    dialog.showMessageBox = (async (_window: unknown, options: Electron.MessageBoxOptions) => {
      kept.sheet = options;
      return new Promise(() => {});
    }) as typeof dialog.showMessageBox;
  });
  await putBack(scene);
  await expect.poll(() => scene.app.evaluate(() => (globalThis as { sheet?: unknown }).sheet !== undefined)).toBe(true);
  const sheet = await scene.app.evaluate(() => (globalThis as { sheet?: Electron.MessageBoxOptions }).sheet);
  expect(sheet?.message).toBe("“notes.md” changed while it was in the Trash");
  expect(sheet?.detail).toBe("Keep the changes you made here, or use the file as it is now?");
  expect(sheet?.buttons).toEqual(["Keep My Changes", "Use the File"]);
  await expect(editor(scene.window)).toHaveText("draftx");
  await scene.window.waitForTimeout(2500);
  expect(readFileSync(scene.home, "utf8")).toBe("final");
  await forceQuit(scene.app);
});

test("TRASH-01.13 put back changed with another tab in front brings the tab forward and typing works after", async () => {
  const scene = await open("draft", { "other.md": "other" });
  await showTab(scene, "notes.md");
  await throwAwayWithAnEditKept(scene);
  writeFileSync(scene.trashed, "final");
  await showTab(scene, "other.md");
  await answerQuestions(scene.app, 1);
  renameSync(scene.trashed, scene.home);
  await expect.poll(() => asked(scene.app)).toEqual(["“notes.md” changed while it was in the Trash"]);
  await expect(selectedTab(scene.window)).toHaveText("notes.md");
  await expect(editor(scene.window)).toHaveText("final");
  await editor(scene.window).click();
  await scene.window.keyboard.press("End");
  await scene.window.keyboard.type("x");
  await expect(editor(scene.window)).toHaveText("finalx");
  await scene.app.close();
});

test("TRASH-01.14 the file dragged out of the Trash closes the tab with no question and leaves the file alone", async () => {
  const scene = await open("draft", { "other.md": "other" });
  await showTab(scene, "notes.md");
  await throwAway(scene);
  await answerQuestions(scene.app, 1);
  const desk = join(scene.folder, "..", "desk");
  mkdirSync(desk, { recursive: true });
  renameSync(scene.trashed, join(desk, "notes.md"));
  await expect(scene.window.locator(".tab")).toHaveCount(0);
  await expect(scene.window.locator(".window-title")).toHaveText("other.md");
  expect(await asked(scene.app)).toEqual([]);
  expect(readFileSync(join(desk, "notes.md"), "utf8")).toBe("draft");
  await scene.app.close();
});

test("TRASH-01.14 the Trash emptied closes the tab of the file and keeps the other", async () => {
  const scene = await open("draft", { "other.md": "other" });
  await showTab(scene, "notes.md");
  await throwAway(scene);
  rmSync(scene.trash, { recursive: true });
  mkdirSync(scene.trash);
  await expect(scene.window.locator(".window-title")).toHaveText("other.md");
  await expect(editor(scene.window)).toHaveText("other");
  await scene.app.close();
});

test("TRASH-01.14 the only document of the window closes with the file", async () => {
  const scene = await open();
  await throwAway(scene);
  const closed = scene.app.waitForEvent("close");
  rmSync(scene.trashed);
  await closed;
});

test("TRASH-01.15 the file dragged out of the Trash with an edit kept leaves an untitled document and the file alone", async () => {
  const scene = await open();
  await throwAwayWithAnEditKept(scene);
  const desk = join(scene.folder, "..", "desk");
  mkdirSync(desk, { recursive: true });
  renameSync(scene.trashed, join(desk, "notes.md"));
  await expect(notice(scene.window)).toBeHidden();
  await expect(scene.window.locator(".window-title")).toHaveText("Untitled");
  await expect(editor(scene.window)).toHaveText("draftx");
  await scene.window.waitForTimeout(2500);
  expect(readFileSync(join(desk, "notes.md"), "utf8")).toBe("draft");
  expect(existsSync(scene.home)).toBe(false);
  await forceQuit(scene.app);
});

test("TRASH-01.15 the untitled document asks to save on close, not the Trash sheet, and Save asks for a place", async () => {
  const scene = await open();
  await throwAwayWithAnEditKept(scene);
  rmSync(scene.trashed);
  await expect(scene.window.locator(".window-title")).toHaveText("Untitled");
  await scene.app.evaluate(({ dialog }) => {
    const kept = globalThis as { asked?: string[]; saveAsked?: number };
    kept.asked = [];
    kept.saveAsked = 0;
    dialog.showMessageBox = (async (_window: unknown, options: Electron.MessageBoxOptions) => {
      kept.asked?.push(options.message);
      return { response: 2, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
    dialog.showSaveDialog = (async () => {
      kept.saveAsked = (kept.saveAsked ?? 0) + 1;
      return { canceled: true, filePath: "" };
    }) as typeof dialog.showSaveDialog;
  });
  await clickMenu(scene.app, "File", "Close");
  await expect.poll(() => asked(scene.app)).toHaveLength(1);
  expect((await asked(scene.app))[0]).toContain("Untitled");
  expect((await asked(scene.app))[0]).not.toContain("without saving");
  await clickMenu(scene.app, "File", "Save");
  await expect
    .poll(() => scene.app.evaluate(() => (globalThis as { saveAsked?: number }).saveAsked))
    .toBeGreaterThan(0);
  await forceQuit(scene.app);
});

test("TRASH-01.16 the sheet taken down by the deleted file keeps the app from quitting and ends as untitled", async () => {
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
  await scene.app.evaluate(({ app }) => app.quit());
  await expect.poll(() => asked(scene.app)).toHaveLength(1);
  rmSync(scene.trashed);
  await expect(scene.window.locator(".window-title")).toHaveText("Untitled");
  await expect(editor(scene.window)).toHaveText("draftx");
  await scene.window.waitForTimeout(1000);
  expect(await scene.app.evaluate(({ app }) => app.isReady())).toBe(true);
  expect(await asked(scene.app)).toHaveLength(1);
  await scene.app.evaluate(({ dialog }) => {
    (globalThis as { asked?: string[] }).asked = [];
    dialog.showMessageBox = (async (_window: unknown, options: Electron.MessageBoxOptions) => {
      (globalThis as { asked?: string[] }).asked?.push(options.message);
      return { response: 2, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
  });
  await clickMenu(scene.app, "File", "Close");
  await expect.poll(() => asked(scene.app)).toHaveLength(1);
  expect((await asked(scene.app))[0]).not.toContain("without saving");
  await forceQuit(scene.app);
});
