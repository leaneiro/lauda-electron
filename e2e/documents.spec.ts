import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
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
  // It shows once its form has said how tall it is.
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().every((w) => w.isVisible())))
    .toBe(true);
  const size = settings.locator('input[type="range"]').first();
  await expect(size).toHaveValue("14");
  // The special fonts, a line, then the system's, as the system lists them
  // to the page.
  await expect(settings.locator("select").first().locator("hr")).toHaveCount(1);
  await expect.poll(() => settings.locator("select").first().locator("hr ~ option").count()).toBeGreaterThan(10);

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

/// The settings file is written once changes pause, and at the latest as
/// the app quits.
/// The appearance is the same kind of control as the view modes, and walks
/// the same way: one stop, the arrows choosing as they go. The keyboard
/// stays on it while the change comes back from the main process.
test("the appearance can be chosen with the keyboard", async () => {
  const { app, window } = await launch({ files: { "a.md": "# A\n" } });
  const opened = app.waitForEvent("window");
  await clickMenu(app, ...(process.platform === "darwin" ? ["Lauda", "Settings…"] : ["File", "Settings…"]));
  const settings = await opened;
  const theme = () => window.evaluate(() => document.documentElement.dataset.theme);
  const initial = await theme();
  await expect(settings.getByRole("radiogroup", { name: "Appearance" })).toBeVisible();
  await expect(settings.getByRole("radio", { checked: true })).toHaveAccessibleName("Automatic");

  await settings.getByRole("radio", { name: "Automatic" }).focus();
  await settings.keyboard.press("End");
  await expect.poll(theme).toBe("dark");
  await expect(settings.getByRole("radio", { checked: true })).toHaveAccessibleName("Dark");
  await expect(settings.getByRole("radio", { name: "Dark" })).toBeFocused();
  await settings.keyboard.press("ArrowLeft");
  await expect.poll(theme).toBe("light");
  await expect(settings.getByRole("radio", { name: "Light" })).toBeFocused();
  await settings.keyboard.press("Home");
  await expect.poll(theme).toBe(initial);
  await expect(settings.getByRole("radio", { name: "Automatic" })).toBeFocused();
  await app.close();
});

test("a setting changed just before quitting is kept", async () => {
  const { app, window, folder } = await launch({ files: { "a.md": "# A\n" } });
  await window.evaluate(() =>
    (globalThis as unknown as { lauda: { invoke: (...args: unknown[]) => Promise<void> } }).lauda.invoke(
      "settings:set",
      { previewFontSize: 21 },
    ),
  );
  await app.close();
  const stored = JSON.parse(readFileSync(join(folder, "..", "user-data", "settings.json"), "utf8"));
  expect(stored.previewFontSize).toBe(21);
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

test("duplicate, rename and move", async () => {
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

/// The column eases to its new width, and the paragraph at the top of the
/// page stays there all the way (the page puts it back on every frame).
test("the text width eases and the reader's place stays", async () => {
  const sentence = "The quick brown fox jumps over the lazy dog. ";
  const paragraphs = Array.from({ length: 120 }, (_, index) => `Paragraph ${index + 1}. ${sentence.repeat(12)}`);
  const { app, window } = await launch({ files: { "long.md": paragraphs.join("\n\n") } });
  const preview = await previewFrame(window);
  await clickMenu(app, "View", "Preview Only");
  // Scrolls just after the pane resized are taken for the resize's own, and
  // not as the reader's place.
  await window.waitForTimeout(800);
  await preview
    .locator("#content > p")
    .nth(59)
    .evaluate((paragraph) => paragraph.scrollIntoView({ block: "start" }));
  await window.waitForTimeout(400);
  const topParagraph = () =>
    preview.evaluate(() => {
      const all = [...document.querySelectorAll("#content > p")];
      return all.findIndex((paragraph) => paragraph.getBoundingClientRect().bottom > 1);
    });
  const width = () => preview.locator("article").evaluate((article) => article.getBoundingClientRect().width);
  const before = await topParagraph();
  const startWidth = await width();

  await window.locator(".width-button").click();
  const widths: number[] = [];
  const tops: number[] = [];
  for (let sample = 0; sample < 6; sample++) {
    await window.waitForTimeout(40);
    widths.push(await width());
    tops.push(await topParagraph());
  }
  await window.waitForTimeout(400);
  const endWidth = await width();
  expect(endWidth).toBeGreaterThan(startWidth);
  expect(widths.some((each) => each > startWidth + 1 && each < endWidth - 1)).toBe(true);
  expect(tops).toEqual(tops.map(() => before));
  expect(await topParagraph()).toBe(before);
  await app.close();
});

/// In preview only, a tab comes back at the reader's place: its hidden frame
/// lost its scroll, and the page took the scroll from the top for the
/// reader's.
test("a tab in preview only comes back at the reader's place", async () => {
  const sentence = "The quick brown fox jumps over the lazy dog. ";
  const text = Array.from({ length: 120 }, (_, index) => `Paragraph ${index + 1}. ${sentence.repeat(12)}`).join("\n\n");
  const { app, window } = await launch({ files: { "first.md": text, "second.md": text } });
  await clickMenu(app, "View", "Preview Only");
  await window.locator(".tab").nth(0).click();
  const preview = await previewFrame(window);
  // Scrolls just after the pane resized are taken for the resize's own.
  await window.waitForTimeout(800);
  await preview
    .locator("#content > p")
    .nth(59)
    .evaluate((paragraph) => paragraph.scrollIntoView({ block: "start" }));
  await window.waitForTimeout(400);
  const topParagraph = () =>
    preview.evaluate(() => {
      const all = [...document.querySelectorAll("#content > p")];
      return all.findIndex((paragraph) => paragraph.getBoundingClientRect().bottom > 1);
    });
  const before = await topParagraph();

  await window.locator(".tab").nth(1).click();
  await window.waitForTimeout(300);
  await window.locator(".tab").nth(0).click();
  await window.waitForTimeout(400);
  expect(await topParagraph()).toBe(before);
  await app.close();
});

/// Every tab's preview gets a new width, one out of view included: back in
/// view, its reader's place is where it was.
test("a preview out of view keeps the reader's place through a width change", async () => {
  const sentence = "The quick brown fox jumps over the lazy dog. ";
  const text = Array.from({ length: 120 }, (_, index) => `Paragraph ${index + 1}. ${sentence.repeat(12)}`).join("\n\n");
  const { app, window } = await launch({ files: { "first.md": text, "second.md": text } });
  await clickMenu(app, "View", "Preview Only");
  await window.locator(".tab").nth(0).click();
  const preview = await previewFrame(window);
  // Scrolls just after the pane resized are taken for the resize's own.
  await window.waitForTimeout(800);
  await preview
    .locator("#content > p")
    .nth(59)
    .evaluate((paragraph) => paragraph.scrollIntoView({ block: "start" }));
  await window.waitForTimeout(400);
  const topParagraph = () =>
    preview.evaluate(() => {
      const all = [...document.querySelectorAll("#content > p")];
      return all.findIndex((paragraph) => paragraph.getBoundingClientRect().bottom > 1);
    });
  const before = await topParagraph();

  await window.locator(".tab").nth(1).click();
  await window.locator(".width-button").click();
  await window.waitForTimeout(500);
  await window.locator(".tab").nth(0).click();
  const tops: number[] = [];
  for (let sample = 0; sample < 12; sample++) {
    await window.waitForTimeout(50);
    tops.push(await topParagraph());
  }
  expect(tops).toEqual(tops.map(() => before));
  await app.close();
});

/// The window names files by path. One it wasn't handed can't be written,
/// moved, watched or have images copied beside it, however it asks: a page
/// taken over by a bug must not reach the rest of the disk.
/// Every permission a page can ask for is refused, but one: the app's own
/// pages may list the installed fonts, for the Settings window's pickers.
/// A document's preview, of an origin of its own, may not.
test("only the app's own pages may list the installed fonts", async () => {
  const { app, window } = await launch({ files: { "a.md": "# A\n" } });
  const preview = await previewFrame(window);
  const state = (name: string) =>
    navigator.permissions.query({ name } as unknown as PermissionDescriptor).then((status) => status.state);
  expect(await window.evaluate(state, "local-fonts")).toBe("granted");
  expect(await preview.evaluate(state, "local-fonts")).toBe("denied");
  expect(await window.evaluate(state, "geolocation")).toBe("denied");
  await app.close();
});

/// The preview page runs its own script and nothing else: the app's other
/// scripts, or its own a second time, would answer the window twice.
test("the preview page loads no script but its own", async () => {
  const { app, window } = await launch({ files: { "a.md": "# A\n" } });
  const preview = await previewFrame(window);
  const outcome = (source: string) =>
    new Promise<string>((resolve) => {
      const script = document.createElement("script");
      script.src = source;
      script.onload = () => resolve("loaded");
      script.onerror = () => resolve("refused");
      document.body.append(script);
    });
  expect(await preview.evaluate(outcome, "lauda-app://app/preview/preview.js")).toBe("refused");
  expect(await preview.evaluate(outcome, "lauda-app://app/renderer/app.js")).toBe("refused");
  await expect(preview.locator("h1")).toHaveText("A");
  await app.close();
});

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

/// The last tab the reader closes takes the window with it, as in the native
/// app; on Windows and Linux that ends the app.
test("closing the last tab closes the window, and leaves no session", async () => {
  const { app, folder } = await launch({ files: { "first.md": "# First\n", "last.md": "# Last\n" } });
  const session = join(folder, "..", "user-data", "session.json");
  const storedFiles = () =>
    existsSync(session) ? (JSON.parse(readFileSync(session, "utf8")) as { files: string[] }).files.length : -1;
  await expect.poll(storedFiles).toBe(2);
  await clickMenu(app, "File", "Close");
  await expect.poll(storedFiles).toBe(1);
  await clickMenu(app, "File", "Close");
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(0);
  // The next launch starts anew rather than bringing the last tab back.
  expect(storedFiles()).toBe(0);
  await forceQuit(app);
});

/// Linux's save panel keeps a name typed without an extension: the app adds
/// .md, and asks before replacing a file already there by that name.
test("saving a new document adds .md and asks before replacing a file", async () => {
  const { app, window, folder } = await launch({ files: { "first.md": "# First\n" } });
  writeFileSync(join(folder, "taken.md"), "old");
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send("menu:command", { name: "new" });
  });
  await window.locator(".document:not([hidden]) .cm-content").click();
  await window.keyboard.type("# New");
  await app.evaluate(
    ({ dialog }, answers) => {
      const asked: string[] = [];
      (globalThis as { asked?: string[] }).asked = asked;
      dialog.showSaveDialog = (async () => ({
        canceled: false,
        filePath: answers.shift(),
      })) as typeof dialog.showSaveDialog;
      dialog.showMessageBox = (async (_window: unknown, options: Electron.MessageBoxOptions) => {
        asked.push(options.message);
        return { response: 1, checkboxChecked: false };
      }) as typeof dialog.showMessageBox;
    },
    [join(folder, "taken"), join(folder, "fresh")],
  );

  // "taken" becomes taken.md, which is there: asked, and kept.
  await clickMenu(app, "File", "Save");
  await expect
    .poll(() => app.evaluate(() => (globalThis as { asked?: string[] }).asked?.[0] ?? ""))
    .toContain("taken.md");
  expect(readFileSync(join(folder, "taken.md"), "utf8")).toBe("old");

  await clickMenu(app, "File", "Save");
  await expect.poll(() => existsSync(join(folder, "fresh.md"))).toBe(true);
  expect(readFileSync(join(folder, "fresh.md"), "utf8")).toBe("# New");
  await expect(window.locator(".tab.is-selected .tab-title")).toHaveText("fresh.md");
  await forceQuit(app);
});

/// However many tabs are open, they share the title bar, narrowing as the
/// native ones do, and none reaches under the controls.
test("many tabs narrow to fit beside the controls", async () => {
  const files = Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`note-${i + 1}.md`, `# Note ${i + 1}\n`]));
  const { app, window } = await launch({ files });
  await expect(window.locator(".tab")).toHaveCount(14);
  await expect
    .poll(async () => {
      const lastTab = await window.locator(".tab").last().boundingBox();
      const controls = await window.locator(".toolbar-right").boundingBox();
      return lastTab && controls ? controls.x - (lastTab.x + lastTab.width) : -1;
    })
    .toBeGreaterThanOrEqual(0);
  await forceQuit(app);
});

/// A tab dragged along the strip takes a new place among the others, and the
/// session keeps the order; a click that doesn't move only selects.
test("dragging a tab reorders the tabs and the session", async () => {
  const { app, window, folder } = await launch({ files: { "a.md": "# A\n", "b.md": "# B\n", "c.md": "# C\n" } });
  const titles = window.locator(".tab-title");
  await expect(titles).toHaveText(["a.md", "b.md", "c.md"]);
  // Once the tabs have come in, where they stand is where they stay.
  await window.waitForTimeout(500);
  const box = async (index: number) => {
    const rect = await window.locator(".tab").nth(index).boundingBox();
    if (!rect) throw new Error("no tab");
    return rect;
  };

  const first = await box(0);
  const last = await box(2);
  await window.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
  await window.mouse.down();
  await window.mouse.move(last.x + last.width - 6, last.y + last.height / 2, { steps: 12 });
  await window.mouse.up();
  await expect(titles).toHaveText(["b.md", "c.md", "a.md"]);
  await expect(window.locator(".tab.is-selected .tab-title")).toHaveText("a.md");

  const session = join(folder, "..", "user-data", "session.json");
  const storedNames = () =>
    existsSync(session)
      ? (JSON.parse(readFileSync(session, "utf8")) as { files: string[] }).files.map((file) =>
          file.split(/[\\/]/).pop(),
        )
      : [];
  await expect.poll(storedNames).toEqual(["b.md", "c.md", "a.md"]);
  // The tab keys walk the new order.
  await window.locator(".tab.is-selected").focus();
  await window.keyboard.press("Home");
  await expect(window.locator(".tab.is-selected .tab-title")).toHaveText("b.md");

  const middle = await box(1);
  await window.mouse.click(middle.x + middle.width / 2, middle.y + middle.height / 2);
  await expect(window.locator(".tab.is-selected .tab-title")).toHaveText("c.md");
  await expect(titles).toHaveText(["b.md", "c.md", "a.md"]);

  // A press pulled away from its tab and let go elsewhere is no click.
  const third = await box(2);
  await window.mouse.move(third.x + third.width / 2, third.y + third.height / 2);
  await window.mouse.down();
  await window.mouse.move(third.x + third.width / 2, third.y + 200, { steps: 6 });
  await window.mouse.up();
  await expect(window.locator(".tab.is-selected .tab-title")).toHaveText("c.md");
  await expect(titles).toHaveText(["b.md", "c.md", "a.md"]);
  await forceQuit(app);
});

/// A tab closed during a drag ends the drag: the tabs left go back to their
/// places, none of them left shifted aside.
test("a tab closed during a drag leaves the others in place", async () => {
  const { app, window } = await launch({ files: { "a.md": "# A\n", "b.md": "# B\n", "c.md": "# C\n" } });
  const titles = window.locator(".tab-title");
  await expect(titles).toHaveText(["a.md", "b.md", "c.md"]);
  await window.waitForTimeout(500);
  const first = await window.locator(".tab").nth(0).boundingBox();
  if (!first) throw new Error("no tab");
  await window.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
  await window.mouse.down();
  // Past the second tab's middle, which moves aside.
  await window.mouse.move(first.x + first.width + 12, first.y + first.height / 2, { steps: 6 });
  await expect(window.locator(".tab").nth(1)).toHaveAttribute("style", /translateX\(-\d/);

  // Held until the closed tab is gone, which takes the drag's own ending with it.
  await clickMenu(app, "File", "Close");
  await expect(titles).toHaveText(["b.md", "c.md"]);
  await window.waitForTimeout(600);
  await window.mouse.up();
  for (const tab of await window.locator(".tab").all()) {
    expect(await tab.evaluate((element) => element.style.transform)).toBe("");
  }
  await forceQuit(app);
});

/// Moves the page makes up while the tabs move report the button up, where
/// the pointer last was (seen under Playwright on macOS); they don't end the
/// drag, and the release drops the tab where it is let go. Dispatched by
/// hand, in that order.
test("a move that reports the button up doesn't end the drag", async () => {
  const { app, window } = await launch({ files: { "a.md": "# A\n", "b.md": "# B\n", "c.md": "# C\n" } });
  const titles = window.locator(".tab-title");
  await expect(titles).toHaveText(["a.md", "b.md", "c.md"]);
  await window.waitForTimeout(500);
  const first = await window.locator(".tab").nth(0).boundingBox();
  const last = await window.locator(".tab").nth(2).boundingBox();
  if (!first || !last) throw new Error("no tab");

  await window.evaluate(
    ({ from, to, y }) => {
      const tab = document.querySelector(".tab");
      if (!tab) throw new Error("no tab");
      const fire = (target: EventTarget, type: string, x: number, buttons: number) =>
        target.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            clientX: x,
            clientY: y,
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true,
            button: type === "pointermove" ? -1 : 0,
            buttons,
          }),
        );
      fire(tab, "pointerdown", from, 1);
      for (let step = 1; step <= 5; step++) fire(globalThis, "pointermove", from + step * 10, 1);
      fire(globalThis, "pointermove", from + 50, 0);
      for (let step = 1; step <= 5; step++)
        fire(globalThis, "pointermove", from + 50 + ((to - from - 50) * step) / 5, 1);
      fire(globalThis, "pointerup", to, 0);
    },
    { from: first.x + first.width / 2, to: last.x + last.width - 6, y: first.y + first.height / 2 },
  );
  await expect(titles).toHaveText(["b.md", "c.md", "a.md"]);
  await forceQuit(app);
});

/// In preview only, choosing a tab hands the keyboard to its preview's page,
/// in a frame of its own; a tab dragged there still takes its new place.
test("a tab dragged in preview only takes its new place", async () => {
  const { app, window } = await launch({ files: { "a.md": "# A\n", "b.md": "# B\n", "c.md": "# C\n" } });
  const titles = window.locator(".tab-title");
  await expect(titles).toHaveText(["a.md", "b.md", "c.md"]);
  await window.getByRole("radio", { name: "Preview Only" }).click();
  await expect(window.locator(".document:not([hidden]) .panes")).toHaveAttribute("data-mode", "previewOnly");
  await window.locator(".tab").nth(2).click();
  await window.waitForTimeout(500);

  const first = await window.locator(".tab").nth(0).boundingBox();
  const last = await window.locator(".tab").nth(2).boundingBox();
  if (!first || !last) throw new Error("no tab");
  await window.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
  await window.mouse.down();
  await window.mouse.move(last.x + last.width - 6, last.y + last.height / 2, { steps: 12 });
  await window.mouse.up();
  await expect(titles).toHaveText(["b.md", "c.md", "a.md"]);
  await forceQuit(app);
});

/// In Ubuntu under UTM the press and the release come as the mouse and the
/// moves between them as a pen with an id of its own: the tab still follows
/// and lands. A finger's move meanwhile doesn't steer it. Dispatched by
/// hand, in that order.
test("a drag whose moves come from another pointer still moves the tab", async () => {
  const { app, window } = await launch({ files: { "a.md": "# A\n", "b.md": "# B\n", "c.md": "# C\n" } });
  const titles = window.locator(".tab-title");
  await expect(titles).toHaveText(["a.md", "b.md", "c.md"]);
  await window.waitForTimeout(500);
  const first = await window.locator(".tab").nth(0).boundingBox();
  const last = await window.locator(".tab").nth(2).boundingBox();
  if (!first || !last) throw new Error("no tab");

  const steered = await window.evaluate(
    ({ from, to, y }) => {
      const tab = document.querySelector<HTMLElement>(".tab");
      if (!tab) throw new Error("no tab");
      const fire = (target: EventTarget, type: string, x: number, pointer: { id: number; kind: string }) =>
        target.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            clientX: x,
            clientY: y,
            pointerId: pointer.id,
            pointerType: pointer.kind,
            isPrimary: true,
            button: type === "pointermove" ? -1 : 0,
            buttons: type === "pointerup" ? 0 : 1,
          }),
        );
      const mouse = { id: 1, kind: "mouse" };
      const pen = { id: 11, kind: "pen" };
      const finger = { id: 20, kind: "touch" };
      fire(tab, "pointerdown", from, mouse);
      for (let step = 1; step <= 8; step++) fire(globalThis, "pointermove", from + ((to - from) * step) / 8, pen);
      const before = tab.style.transform;
      fire(globalThis, "pointermove", from, finger);
      const after = tab.style.transform;
      fire(globalThis, "pointerup", to, mouse);
      return before !== after;
    },
    { from: first.x + first.width / 2, to: last.x + last.width - 6, y: first.y + first.height / 2 },
  );
  expect(steered).toBe(false);
  await expect(titles).toHaveText(["b.md", "c.md", "a.md"]);
  await forceQuit(app);
});

/// Ctrl+Tab and Ctrl+Shift+Tab walk the tabs, from the editor too. Keys the
/// test types never pass through the window's own key handler, so it is handed
/// the press as the system would.
test("ctrl+tab walks the tabs", async () => {
  const { app, window } = await launch({ files: { "a.md": "# A\n", "b.md": "# B\n", "c.md": "# C\n" } });
  const selected = window.locator(".tab.is-selected .tab-title");
  await expect(window.locator(".tab-title")).toHaveText(["a.md", "b.md", "c.md"]);
  await window.locator(".tab").nth(0).click();
  await expect(selected).toHaveText("a.md");
  await window.locator(".document:not([hidden]) .cm-content").click();
  const press = (shift: boolean) =>
    app.evaluate(({ BrowserWindow }, shift) => {
      const input = { type: "keyDown", key: "Tab", control: true, shift, alt: false, meta: false };
      BrowserWindow.getAllWindows()[0]?.webContents.emit("before-input-event", { preventDefault() {} }, input);
    }, shift);

  await press(false);
  await expect(selected).toHaveText("b.md");
  await press(true);
  await press(true);
  await expect(selected).toHaveText("c.md");
  await forceQuit(app);
});

/// A file that can't be written: the error is said once, however often the
/// window loses focus meanwhile (the error box itself takes it), and again
/// when a save is asked for. The text stays.
test("a failing save is reported once, not in a loop", async () => {
  // A read-only folder stops no writes on Windows, nor as root.
  test.skip(process.platform === "win32" || process.getuid?.() === 0, "a read-only folder doesn't stop writes here");
  const { app, window, folder } = await launch({ files: { "locked.md": "# Locked\n" } });
  await app.evaluate(({ dialog, BrowserWindow }) => {
    const state = globalThis as { errors?: number };
    state.errors = 0;
    dialog.showMessageBox = (async () => {
      state.errors = (state.errors ?? 0) + 1;
      // A real box takes the focus from the window; a few times is enough to
      // tell a loop.
      if (state.errors <= 5) {
        await BrowserWindow.getAllWindows()[0]?.webContents.executeJavaScript(
          "window.dispatchEvent(new Event('blur'))",
        );
      }
      return { response: 0, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
  });
  chmodSync(folder, 0o555);
  try {
    await window.locator(".document:not([hidden]) .cm-content").click();
    await window.keyboard.press("End");
    await window.keyboard.type(" kept");
    const errors = () => app.evaluate(() => (globalThis as { errors?: number }).errors);
    await expect.poll(errors, { timeout: 8000 }).toBe(1);
    await window.waitForTimeout(3000);
    expect(await errors()).toBe(1);
    await expect(window.locator(".document:not([hidden]) .cm-content")).toContainText("Locked kept");

    await clickMenu(app, "File", "Save");
    await expect.poll(errors, { timeout: 8000 }).toBe(2);
  } finally {
    chmodSync(folder, 0o755);
  }
  await forceQuit(app);
});

/// The chain on the divider: apart, each pane scrolls on its own; joined
/// again, the editor comes to the preview, and both follow each other
/// (ScrollLinkPanesTests.swift).
test("the chain on the divider parts the panes and rejoins them at the preview", async () => {
  const sections = Array.from(
    { length: 60 },
    (_, i) => `## Section ${i + 1}\n\n${"Some text that fills a line or two. ".repeat(6)}\n`,
  ).join("\n");
  const { app, window } = await launch({ files: { "long.md": `# Long\n\n${sections}` } });
  const preview = await previewFrame(window);
  await expect(preview.locator("h2")).toHaveCount(60);
  const chain = window.locator(".document:not([hidden]) .chain-button");
  const scroller = window.locator(".document:not([hidden]) .cm-scroller");
  const headingTop = (index: number) =>
    preview
      .locator("h2")
      .nth(index)
      .evaluate((heading) => Math.round(heading.getBoundingClientRect().top));
  const scrollPage = (index: number) =>
    preview
      .locator("h2")
      .nth(index)
      .evaluate((heading) => globalThis.scrollTo(0, heading.getBoundingClientRect().top + globalThis.scrollY));
  // Near the section first, since the editor only lays out the lines around
  // what it shows, then its heading at the top.
  const scrollEditor = async (section: number) => {
    await scroller.evaluate(
      (element, fraction) => {
        element.scrollTop = element.scrollHeight * fraction;
      },
      (section - 1) / 60,
    );
    await window.waitForTimeout(200);
    await scroller.evaluate((element, text) => {
      const line = [...element.querySelectorAll(".cm-line")].find((l) => l.textContent === text);
      if (line) element.scrollTop += line.getBoundingClientRect().top - element.getBoundingClientRect().top;
    }, `## Section ${section}`);
  };

  // The chain comes with the pointer on the divider, once both panes scroll.
  // The pointer goes to the divider away from its middle: at the middle the
  // chain comes up under it and is what receives it, which the hover waits
  // out.
  await expect(window.locator(".document:not([hidden]) .divider")).toHaveClass(/has-room/);
  await expect(chain).toHaveCSS("opacity", "0");
  await window.locator(".document:not([hidden]) .divider-handle").hover({ position: { x: 5, y: 80 } });
  await expect(chain).toHaveCSS("opacity", "1");
  await expect(chain).toHaveAttribute("aria-label", "Scroll the panes separately");

  // Together, the preview follows the editor.
  await scrollEditor(30);
  await expect.poll(() => headingTop(29), { timeout: 3000 }).toBeLessThan(80);
  expect(await headingTop(29)).toBeGreaterThan(-40);
  await window.waitForTimeout(300);

  // Apart, neither follows the other.
  await chain.click();
  await expect(chain).toHaveClass(/is-apart/);
  await expect(chain).toHaveAttribute("aria-label", "Scroll the panes together");
  const editorBefore = await scroller.evaluate((element) => element.scrollTop);
  await scrollPage(45);
  await window.waitForTimeout(300);
  expect(await scroller.evaluate((element) => element.scrollTop)).toBe(editorBefore);
  await scrollEditor(10);
  await window.waitForTimeout(300);
  expect(Math.abs(await headingTop(45))).toBeLessThan(2);

  // Joined again, the editor comes to the preview, though the editor
  // scrolled last, and follows it from there.
  await window.locator(".document:not([hidden]) .divider-handle").hover({ position: { x: 5, y: 80 } });
  await chain.click();
  await expect(chain).not.toHaveClass(/is-apart/);
  await expect
    .poll(
      () =>
        scroller.evaluate((element) => {
          const line = [...element.querySelectorAll(".cm-line")].find((l) => l.textContent === "## Section 46");
          return line ? Math.round(line.getBoundingClientRect().top - element.getBoundingClientRect().top) : null;
        }),
      { timeout: 3000 },
    )
    .toBeLessThan(40);
  await window.waitForTimeout(300);
  await scrollPage(10);
  await expect
    .poll(
      () =>
        scroller.evaluate((element) => {
          const line = [...element.querySelectorAll(".cm-line")].find((l) => l.textContent === "## Section 11");
          return line ? Math.round(line.getBoundingClientRect().top - element.getBoundingClientRect().top) : null;
        }),
      { timeout: 3000 },
    )
    .toBeLessThan(40);
  await forceQuit(app);
});

test("a text that fits leaves the chain out of view", async () => {
  const long = Array.from({ length: 40 }, (_, i) => `## Section ${i + 1}\n\n${"Text. ".repeat(40)}\n`).join("\n");
  const { app, window } = await launch({ files: { "long.md": long, "short.md": "# Short\n\nOne paragraph.\n" } });
  const divider = window.locator(".document:not([hidden]) .divider");
  const chain = window.locator(".document:not([hidden]) .chain-button");
  // The long text's panes tell they scroll, so the telling works in this
  // run; the short text's then don't.
  await window.locator(".tab", { hasText: "long.md" }).click();
  await expect(divider).toHaveClass(/has-room/);
  await window.locator(".tab", { hasText: "short.md" }).click();
  await previewFrame(window);
  await window.waitForTimeout(500);
  await expect(divider).not.toHaveClass(/has-room/);
  await expect(chain).toHaveAttribute("aria-hidden", "true");
  await window.locator(".document:not([hidden]) .divider-handle").hover({ position: { x: 5, y: 80 } });
  await window.waitForTimeout(300);
  await expect(chain).toHaveCSS("opacity", "0");
  await forceQuit(app);
});
