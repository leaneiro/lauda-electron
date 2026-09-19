import { _electron as electron, expect, test } from "@playwright/test";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  const app = await electron.launch({ colorScheme: null, args: ["."], env: { ...process.env, LAUDA_USER_DATA: folder, LAUDA_LOCALE: "pt-BR" } });
  const window = await app.firstWindow();
  await expect(window.locator(".window-title")).toHaveText("Boas-vindas");
  const preview = await previewFrame(window);
  await expect(preview.locator("h1")).toContainText("Boas-vindas ao Lauda");
  await expect(preview.locator("h1 .wordmark")).toHaveText("Lauda");
  await expect(window.locator(".save-status")).toHaveAttribute("data-status", "notSavedYet");
  await forceQuit(app);
});

test("a pasted screenshot is saved next to the document and linked", async () => {
  const { app, window, folder } = await launch({ files: { "shots.md": "" } });
  await window.locator(".cm-content").click();
  await app.evaluate(async ({ clipboard, ClipboardItem }) => {
    const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    clipboard.clear();
    await clipboard.write([new ClipboardItem({ "image/png": new Blob([pixel], { type: "image/png" }) })]);
  });
  // Paste acts on the focused window, which a test's window may not be.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.paste());
  await expect(window.locator(".cm-content")).toHaveText(/^!\[\]\(image-\d{8}-\d{6}\.png\)$/);
  const images = readdirSync(folder).filter((name) => name.endsWith(".png"));
  expect(images).toHaveLength(1);
  const preview = await previewFrame(window);
  await expect(preview.locator("img")).toHaveJSProperty("complete", true);
  await expect.poll(() => preview.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
  await app.close();
});

test("scrolling the editor brings the preview to the same block", async () => {
  const sections = Array.from({ length: 40 }, (_, i) => `## Section ${i + 1}\n\n${"Some text that fills a line or two. ".repeat(6)}\n`).join("\n");
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
    .poll(() => preview.locator("h2").nth(19).evaluate((heading) => Math.round(heading.getBoundingClientRect().top)), { timeout: 3000 })
    .toBeLessThan(80);
  const top = await preview.locator("h2").nth(19).evaluate((heading) => heading.getBoundingClientRect().top);
  expect(top).toBeGreaterThan(-40);

  // And back: the preview scrolled to Section 30 brings the editor there.
  // (Just after the app moved the preview, its scroll events are echoes and
  // ignored for a moment, as in the native preview.)
  await window.waitForTimeout(400);
  await preview.locator("h2").nth(29).evaluate((heading) => {
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

test("dropping a Markdown file on the window opens it as a tab", async () => {
  const { app, window, folder } = await launch({ files: { "first.md": "# First\n" } });
  const second = join(folder, "second.md");
  writeFileSync(second, "# Second\n");
  await window.evaluate((path) => (globalThis as unknown as { lauda: { invoke: (c: string, p: string[]) => Promise<void> } }).lauda.invoke("app:open-files", [path]), second);
  await expect(window.locator(".tab")).toHaveCount(2);
  expect(existsSync(second)).toBe(true);
  await app.close();
});
