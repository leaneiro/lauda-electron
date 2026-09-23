import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import { clickMenu, forceQuit, launch, previewFrame } from "./launch";

test("a backtick from a dead key pairs and closes, as on a Brazilian keyboard", async () => {
  const { app, window } = await launch({ files: { "dead.md": "" } });
  await window.locator(".cm-content").click();
  const cdp = await window.context().newCDPSession(window);
  const deadKey = async (character: string) => {
    await cdp.send("Input.imeSetComposition", { text: character, selectionStart: 1, selectionEnd: 1 });
    await cdp.send("Input.insertText", { text: character });
    await window.waitForTimeout(80);
  };
  await deadKey("`");
  await window.keyboard.type("code");
  await deadKey("`");
  await window.keyboard.type(" after");
  await expect(window.locator(".cm-content")).toHaveText("`code` after");
  await app.close();
});

test("the welcome guide opens on the first launch", async () => {
  const folder = mkdtempSync(join(tmpdir(), "lauda-first-"));
  const app = await electron.launch({
    colorScheme: null,
    args: ["."],
    env: { ...process.env, LAUDA_USER_DATA: folder, LAUDA_LOCALE: "pt-BR" },
  });
  const window = await app.firstWindow();
  await expect(window.locator(".window-title")).toHaveText("Boas-vindas");
  const preview = await previewFrame(window);
  await expect(preview.locator("h1")).toContainText("Boas-vindas ao Lauda");
  await expect(preview.locator("h1 .wordmark")).toHaveText("Lauda");
  await expect(window.locator(".save-status")).toHaveAttribute("data-status", "notSavedYet");
  // On a Mac it reads with the Mac's keys, as the menus around it do.
  await expect(window.locator(".cm-content")).toContainText("⌘B");
  // It counts as shown once the page has it, and the next launch knows.
  const settingsFile = join(folder, "settings.json");
  await expect
    .poll(() =>
      existsSync(settingsFile) ? JSON.parse(readFileSync(settingsFile, "utf8")).hasShownWelcomeGuide : false,
    )
    .toBe(true);
  await forceQuit(app);
});

/// Windows and Linux read the same guide with their own keys: it comes from
/// the native app, written with the Mac's.
test("Help > Welcome Guide opens the guide as a tab", async () => {
  const { app, window } = await launch({ files: { "notes.md": "# Notes\n" } });
  await expect(window.locator(".window-title")).toHaveText("notes.md");
  await clickMenu(app, "Help", "Welcome Guide");
  await expect(window.locator(".tab")).toHaveCount(2);
  await expect(window.locator(".tab.is-selected .tab-title")).toHaveText("Welcome");
  await forceQuit(app);
});

test("the welcome guide speaks the system's shortcuts", async () => {
  const folder = mkdtempSync(join(tmpdir(), "lauda-first-"));
  const app = await electron.launch({
    colorScheme: null,
    args: ["."],
    env: { ...process.env, LAUDA_USER_DATA: folder, LAUDA_LOCALE: "pt-BR", LAUDA_PLATFORM: "win32" },
  });
  const window = await app.firstWindow();
  const guide = window.locator(".cm-content");
  await expect(guide).toContainText("Ctrl+B");
  await expect(guide).toContainText("Ctrl+Shift+X");
  expect(await guide.innerText()).not.toContain("⌘");
  await forceQuit(app);
});

test("a pasted screenshot is saved next to the document and linked", async () => {
  const { app, window, folder } = await launch({ files: { "shots.md": "" } });
  await window.locator(".cm-content").click();
  await app.evaluate(async ({ clipboard, ClipboardItem }) => {
    const pixel = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    clipboard.clear();
    await clipboard.write([new ClipboardItem({ "image/png": new Blob([pixel], { type: "image/png" }) })]);
  });
  // Paste acts on the focused window, which a test's window may not be.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.paste());
  await expect(window.locator(".cm-content")).toHaveText(/^!\[\]\(image-\d{8}-\d{6}\.png\)$/);
  const images = readdirSync(folder).filter((name) => name.endsWith(".png"));
  expect(images).toHaveLength(1);
  const preview = await previewFrame(window);
  await expect(preview.locator("img")).toHaveJSProperty("complete", true);
  await expect.poll(() => preview.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
  await app.close();
});

test("scrolling the editor brings the preview to the same block", async () => {
  const sections = Array.from(
    { length: 40 },
    (_, i) => `## Section ${i + 1}\n\n${"Some text that fills a line or two. ".repeat(6)}\n`,
  ).join("\n");
  const { app, window } = await launch({ files: { "long.md": `# Long\n\n${sections}` } });
  const preview = await previewFrame(window);
  await expect(preview.locator("h2")).toHaveCount(40);
  // Scroll the editor until "## Section 20" is at the top: near it first,
  // since the editor only lays out the lines around what it shows.
  await window.locator(".cm-scroller").evaluate((scroller) => {
    scroller.scrollTop = scroller.scrollHeight * 0.46;
  });
  await window.waitForTimeout(200);
  await window.locator(".cm-scroller").evaluate((scroller) => {
    const line = [...scroller.querySelectorAll(".cm-line")].find((l) => l.textContent === "## Section 20");
    if (line) scroller.scrollTop += line.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 20;
  });
  await expect
    .poll(
      () =>
        preview
          .locator("h2")
          .nth(19)
          .evaluate((heading) => Math.round(heading.getBoundingClientRect().top)),
      { timeout: 3000 },
    )
    .toBeLessThan(80);
  const top = await preview
    .locator("h2")
    .nth(19)
    .evaluate((heading) => heading.getBoundingClientRect().top);
  expect(top).toBeGreaterThan(-40);

  // And back: the preview scrolled to Section 30 brings the editor there.
  // (Just after the app moved the preview, its scroll events are echoes and
  // ignored for a moment, as in the native preview.)
  await window.waitForTimeout(400);
  await preview
    .locator("h2")
    .nth(29)
    .evaluate((heading) => {
      const page = heading.ownerDocument.defaultView!;
      page.scrollTo(0, heading.getBoundingClientRect().top + page.scrollY - 48);
    });
  await expect
    .poll(
      () =>
        window.locator(".cm-scroller").evaluate((scroller) => {
          const line = [...scroller.querySelectorAll(".cm-line")].find((l) => l.textContent === "## Section 30");
          return line ? Math.round(line.getBoundingClientRect().top - scroller.getBoundingClientRect().top) : 9999;
        }),
      { timeout: 3000 },
    )
    .toBeLessThan(80);
  await app.close();
});

/// Where each block and list item sits is measured once and kept until the
/// text moves, not again on every scroll event: a long list made each event
/// a pass over the page.
test("scrolling the preview reads the anchors it measured", async () => {
  const items = Array.from({ length: 300 }, (_, i) => `- item ${i + 1}`).join("\n");
  const { app, window } = await launch({ files: { "list.md": `# List\n\n${items}\n` } });
  const preview = await previewFrame(window);
  await expect(preview.locator("li")).toHaveCount(300);
  // Past the moment after the content arrived, when scroll events are echoes.
  await window.waitForTimeout(400);
  type Counted = typeof globalThis & { previewScrolls?: number };
  await window.evaluate(() => {
    const page = globalThis as Counted;
    page.previewScrolls = 0;
    page.addEventListener("message", (event: MessageEvent) => {
      if (event.data?.type === "previewScrolled") page.previewScrolls = (page.previewScrolls ?? 0) + 1;
    });
  });
  const measured = await preview.evaluate(async () => {
    let count = 0;
    const measure = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      count += 1;
      return measure.call(this);
    };
    for (let step = 1; step <= 10; step++) {
      globalThis.scrollTo(0, step * 120);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    Element.prototype.getBoundingClientRect = measure;
    return count;
  });
  await expect.poll(() => window.evaluate(() => (globalThis as Counted).previewScrolls)).toBeGreaterThan(5);
  // The heading, the list and its 300 items, measured at most once.
  expect(measured).toBeLessThanOrEqual(302);
  await app.close();
});

test("dropping a Markdown file on the window opens it as a tab", async () => {
  const { app, window, folder } = await launch({ files: { "first.md": "# First\n" } });
  const second = join(folder, "second.md");
  writeFileSync(second, "# Second\n");
  await window.evaluate(
    (path) =>
      (globalThis as unknown as { lauda: { invoke: (c: string, p: string[]) => Promise<void> } }).lauda.invoke(
        "app:open-files",
        [path],
      ),
    second,
  );
  await expect(window.locator(".tab")).toHaveCount(2);
  expect(existsSync(second)).toBe(true);
  await app.close();
});

/// Find and Replace… opens CodeMirror's own panel, whose words are English
/// unless the editor gives it the reader's.
test("find and replace speaks the reader's language", async () => {
  const { app, window, folder } = await launch({
    locale: "pt-BR",
    files: { "semana.md": "uma semana, outra semana\n" },
  });
  await window.locator(".cm-content").click();
  await clickMenu(app, "Editar", "Localizar e Substituir…");
  const panel = window.locator(".document:not([hidden]) .cm-search");
  await expect(panel.locator("input[name=search]")).toHaveAttribute("placeholder", "Localizar");
  await expect(panel.locator("input[name=replace]")).toHaveAttribute("placeholder", "Substituir");
  await expect(panel.locator("button[name=next]")).toHaveText("Seguinte");
  await expect(panel.locator("button[name=replaceAll]")).toHaveText("Substituir Tudo");
  await expect(panel.locator("label").first()).toHaveText("Diferenciar maiúsculas");
  await expect(panel.locator("button[name=close]")).toHaveAttribute("aria-label", "Fechar");

  await panel.locator("input[name=search]").click();
  await window.keyboard.type("semana");
  await panel.locator("input[name=replace]").click();
  await window.keyboard.type("SEMANA");
  await panel.locator("button[name=replaceAll]").click();
  await expect(window.locator(".document:not([hidden]) .cm-content")).toHaveText("uma SEMANA, outra SEMANA");
  await expect.poll(() => readFileSync(join(folder, "semana.md"), "utf8")).toBe("uma SEMANA, outra SEMANA\n");
  await app.close();
});
