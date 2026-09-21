import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { _electron as electron, expect, type Page, test } from "@playwright/test";
import { clickMenu, forceQuit, launch, previewFrame } from "./launch";

test("exports HTML and PDF next to the document", async () => {
  const { app, window, folder } = await launch({ files: { "report.md": "# Report\n\nSome **text**.\n" } });
  await previewFrame(window);
  const htmlPath = join(folder, "report.html");
  const pdfPath = join(folder, "report.pdf");
  await app.evaluate(
    ({ dialog }, paths) => {
      let call = 0;
      dialog.showSaveDialog = (async () => ({
        canceled: false,
        filePath: paths[call++],
      })) as typeof dialog.showSaveDialog;
    },
    [htmlPath, pdfPath],
  );

  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send("menu:command", { name: "export-html" });
  });
  await expect.poll(() => existsSync(htmlPath)).toBe(true);
  const html = readFileSync(htmlPath, "utf8");
  expect(html).toContain("<h1");
  expect(html).toContain("<strong>text</strong>");
  expect(html).toContain("script-src 'none'");

  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send("menu:command", { name: "export-pdf" });
  });
  await expect.poll(() => existsSync(pdfPath), { timeout: 15_000 }).toBe(true);
  expect(readFileSync(pdfPath).subarray(0, 5).toString()).toBe("%PDF-");
  await app.close();
});

test("the tabs left open come back at the next launch", async () => {
  const first = await launch({ files: { "one.md": "# One\n", "two.md": "# Two\n" } });
  await expect(first.window.locator(".tab")).toHaveCount(2);
  await first.window.locator(".tab").first().click();
  await expect(first.window.locator(".tab.is-selected .tab-title")).toHaveText("one.md");
  await first.window.waitForTimeout(400);
  const userData = await first.app.evaluate(({ app }) => app.getPath("userData"));
  await first.app.close();

  const session = JSON.parse(readFileSync(join(userData, "session.json"), "utf8"));
  expect(session.files.map((file: string) => file.split(/[\\/]/).pop())).toEqual(["one.md", "two.md"]);
  expect(session.selected.endsWith("one.md")).toBe(true);

  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, LAUDA_USER_DATA: userData, LAUDA_LOCALE: "en" },
  });
  const window = await app.firstWindow();
  await expect(window.locator(".tab")).toHaveCount(2);
  await expect(window.locator(".tab.is-selected .tab-title")).toHaveText("one.md");
  await app.close();
});

test("closing a new document with text asks whether to keep it", async () => {
  const { app, window } = await launch({ files: { "keep.md": "# Keep\n" } });
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send("menu:command", { name: "new" });
  });
  await expect(window.locator(".tab")).toHaveCount(2);
  await expect(window.locator(".tab.is-selected .tab-title")).toHaveText("Untitled");
  await window.locator(".document:not([hidden]) .cm-content").click();
  await window.keyboard.type("draft");
  await expect(window.locator(".tab.is-selected")).toHaveClass(/is-edited/);

  await app.evaluate(({ dialog }) => {
    (globalThis as { asked?: string }).asked = "";
    dialog.showMessageBox = (async (_window: unknown, options: Electron.MessageBoxOptions) => {
      (globalThis as { asked?: string }).asked = options.message;
      return { response: 2, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
  });
  await clickMenu(app, "File", "Close");
  await expect.poll(() => app.evaluate(() => (globalThis as { asked?: string }).asked)).toContain("Untitled");
  await expect(window.locator(".tab")).toHaveCount(2);

  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox;
  });
  await clickMenu(app, "File", "Close");
  await expect(window.locator(".tab")).toHaveCount(0);
  await expect(window.locator(".window-title")).toHaveText("keep.md");
  await forceQuit(app);
});

test("settings reach the editor and the preview", async () => {
  const { app, window } = await launch({ files: { "style.md": "Line one\nLine two\n" } });
  const preview = await previewFrame(window);
  await expect(preview.locator("p br")).toHaveCount(1);
  await window.evaluate(() =>
    (globalThis as unknown as { lauda: { invoke: (...args: unknown[]) => Promise<void> } }).lauda.invoke(
      "settings:set",
      { strictLineBreaks: true, editorFontSize: 18 },
    ),
  );
  await expect(preview.locator("p br")).toHaveCount(0);
  await expect
    .poll(() =>
      window
        .locator(".editor-pane")
        .first()
        .evaluate((el) => getComputedStyle(el).getPropertyValue("--editor-size").trim()),
    )
    .toBe("18px");
  await app.close();
});

/// The editor's text size as the window applies it.
function editorSize(window: Page): Promise<string> {
  return window
    .locator(".editor-pane")
    .first()
    .evaluate((pane) => getComputedStyle(pane).getPropertyValue("--editor-size").trim());
}

test("the Settings window stores each change, and Restore Defaults shows the defaults", async () => {
  const { app, window } = await launch({ files: { "style.md": "Text\n" } });
  await previewFrame(window);
  const opened = app.waitForEvent("window");
  await clickMenu(app, ...(process.platform === "darwin" ? ["Lauda", "Settings…"] : ["File", "Settings…"]));
  const settings = await opened;
  const size = settings.locator('input[type="range"]').first();
  await expect(size).toHaveValue("14");
  // The special fonts, a line, then the system's.
  await expect(settings.locator("select").first().locator("hr")).toHaveCount(1);

  await size.focus();
  await settings.keyboard.press("ArrowRight");
  await settings.keyboard.press("ArrowRight");
  await expect.poll(() => editorSize(window)).toBe("16px");
  // The slider stays where the reader has it while its own changes come back.
  await expect(size).toBeFocused();

  await settings.getByRole("button", { name: "Restore Defaults" }).click();
  await expect(settings.locator('input[type="range"]').first()).toHaveValue("14");
  await expect.poll(() => editorSize(window)).toBe("14px");
  await app.close();
});

test("a file changed by another program shows its new text", async () => {
  const { app, window, folder } = await launch({ files: { "outside.md": "# Before\n" } });
  const preview = await previewFrame(window);
  await expect(preview.locator("h1")).toHaveText("Before");
  writeFileSync(join(folder, "outside.md"), "# After\n");
  await expect(preview.locator("h1")).toHaveText("After", { timeout: 5000 });
  await expect(window.locator(".cm-content")).toHaveText("# After");
  await app.close();
});

/// Another app changes a file the reader has changes of their own to: as
/// NSDocument does, the reader chooses which to keep, and nothing is written
/// over the file before they have.
test("a file changed elsewhere under unsaved changes asks which to keep", async () => {
  const { app, window, folder } = await launch({ files: { "both.md": "# Start\n" } });
  await previewFrame(window);
  const file = join(folder, "both.md");
  const answerWith = (response: number) =>
    app.evaluate(({ dialog }, response) => {
      (globalThis as { asked?: string }).asked = "";
      dialog.showMessageBox = (async (_window: unknown, options: Electron.MessageBoxOptions) => {
        (globalThis as { asked?: string }).asked = options.message;
        return { response, checkboxChecked: false };
      }) as typeof dialog.showMessageBox;
    }, response);
  const asked = () => app.evaluate(() => (globalThis as { asked?: string }).asked);
  const editor = window.locator(".cm-content");
  await editor.click();

  // Revert: the other app's text, in the editor and in the file.
  await answerWith(1);
  await window.keyboard.press(process.platform === "darwin" ? "Meta+End" : "Control+End");
  await window.keyboard.type("mine");
  writeFileSync(file, "# Theirs\n");
  await expect.poll(asked).toContain("both.md");
  await expect(editor).toHaveText("# Theirs");
  await expect(window.locator(".save-status")).toHaveAttribute("data-status", "saved");
  expect(readFileSync(file, "utf8")).toBe("# Theirs\n");

  // Save Anyway: the reader's text replaces the file.
  await answerWith(0);
  await window.keyboard.press(process.platform === "darwin" ? "Meta+End" : "Control+End");
  await window.keyboard.type("mine");
  writeFileSync(file, "# Theirs again\n");
  await expect.poll(asked).toContain("both.md");
  await expect.poll(() => readFileSync(file, "utf8")).toBe("# Theirs\nmine");
  await expect.poll(() => editor.innerText()).toBe("# Theirs\nmine");
  await app.close();
});

test("duplicate, revert, rename and move", async () => {
  const { app, window, folder } = await launch({ files: { "draft.md": "# Draft\n" } });
  await window.locator(".cm-content").click();
  await window.keyboard.press(process.platform === "darwin" ? "Meta+End" : "Control+End");
  await window.keyboard.type("more");

  await clickMenu(app, "File", "Duplicate");
  await expect(window.locator(".tab")).toHaveCount(2);
  await expect(window.locator(".tab.is-selected .tab-title")).toHaveText("draft copy");
  await expect(window.locator(".tab.is-selected")).toHaveClass(/is-edited/);
  await expect(window.locator(".document:not([hidden]) .cm-content")).toHaveText("# Draftmore");
  await window.locator(".tab").first().click();

  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox;
  });
  await clickMenu(app, "File", "Revert to Saved");
  await expect(window.locator(".document:not([hidden]) .cm-content")).toHaveText("# Draft");
  await expect.poll(() => readFileSync(join(folder, "draft.md"), "utf8")).toBe("# Draft\n");

  const renamed = join(folder, "final.md");
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog;
  }, renamed);
  await clickMenu(app, "File", "Rename…");
  await expect(window.locator(".tab.is-selected .tab-title")).toHaveText("final.md");
  expect(existsSync(renamed)).toBe(true);
  expect(existsSync(join(folder, "draft.md"))).toBe(false);

  const elsewhere = join(folder, "moved");
  require("node:fs").mkdirSync(elsewhere);
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [path] })) as typeof dialog.showOpenDialog;
  }, elsewhere);
  await clickMenu(app, "File", "Move To…");
  await expect.poll(() => existsSync(join(elsewhere, "final.md"))).toBe(true);
  expect(existsSync(renamed)).toBe(false);

  // The menu is built again once the move is noted, a beat after the file
  // lands, so the list is waited for rather than read the moment it does.
  await expect
    .poll(() =>
      app.evaluate(
        ({ Menu }) =>
          Menu.getApplicationMenu()!
            .items.find((item) => item.label === "File")!
            .submenu!.items.find((item) => item.label === "Open Recent")!
            .submenu!.items.map((item) => item.label)[0],
      ),
    )
    .toBe("final.md");
  await forceQuit(app);
});

/// A screen that was unplugged would leave the window out of reach. macOS
/// brings such a window back by itself; Windows and Linux leave it where it
/// is told, which is what this checks there (placement.test.ts has the rule).
test("a window last seen on a screen that is gone opens where it can be reached", async () => {
  const { app } = await launch({
    files: { "a.md": "# A\n" },
    windowState: { x: 20000, y: 20000, width: 900, height: 600, maximized: false },
  });
  const reachable = await app.evaluate(({ BrowserWindow, screen }) => {
    const bounds = BrowserWindow.getAllWindows()[0]?.getBounds();
    if (!bounds) return false;
    return screen.getAllDisplays().some(({ workArea: area }) => {
      return (
        bounds.x >= area.x && bounds.y >= area.y && bounds.x < area.x + area.width && bounds.y < area.y + area.height
      );
    });
  });
  expect(reachable).toBe(true);
  await app.close();
});

test("the text width button cycles in preview-only mode", async () => {
  const { app, window } = await launch({ files: { "wide.md": "# Wide\n\ntext\n" } });
  const preview = await previewFrame(window);
  await clickMenu(app, "View", "Preview Only");
  const width = () => preview.locator("article").evaluate((article) => getComputedStyle(article).maxWidth);
  await expect.poll(width).toBe(`${46 * 16}px`);
  await window.locator(".width-button").click();
  await expect.poll(width).toBe(`${66 * 16}px`);
  await window.locator(".width-button").click();
  await expect.poll(width).toBe(`${90 * 16}px`);
  await window.locator(".width-button").click();
  await expect.poll(width).toBe(`${46 * 16}px`);
  await clickMenu(app, "View", "Editor and Preview");
  await app.close();
});

/// The window names files by path. One it wasn't handed can't be written,
/// moved, watched or have images copied beside it, however it asks: a page
/// taken over by a bug must not reach the rest of the disk.
test("the window can only write the files it was handed", async () => {
  const { app, window, folder } = await launch({ files: { "mine.md": "# Mine\n" } });
  await expect(window.locator(".window-title")).toHaveText("mine.md");
  const elsewhere = join(folder, "not-opened.md");
  const answer = await window.evaluate(
    (path) =>
      (globalThis as unknown as { lauda: { invoke: (c: string, ...a: unknown[]) => Promise<unknown> } }).lauda.invoke(
        "doc:write",
        path,
        "written anyway",
      ),
    elsewhere,
  );
  expect(answer).toMatchObject({ ok: false });
  expect(existsSync(elsewhere)).toBe(false);

  // The file it opened is still its to write.
  const opened = join(folder, "mine.md");
  const allowed = await window.evaluate(
    (path) =>
      (globalThis as unknown as { lauda: { invoke: (c: string, ...a: unknown[]) => Promise<unknown> } }).lauda.invoke(
        "doc:write",
        path,
        "# Mine, again\n",
      ),
    opened,
  );
  expect(allowed).toMatchObject({ ok: true });
  expect(readFileSync(opened, "utf8")).toBe("# Mine, again\n");
  await forceQuit(app);
});
