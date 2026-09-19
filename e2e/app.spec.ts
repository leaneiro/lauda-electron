import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { clickMenu, forceQuit, launch, previewFrame } from "./launch";

const mod = process.platform === "darwin" ? "Meta" : "Control";

test("opens a file and renders its preview", async () => {
  const { app, window } = await launch({ files: { "notes.md": "# Title\n\nA paragraph with **bold** text.\n" } });
  await expect(window.locator(".window-title")).toHaveText("notes.md");
  const preview = await previewFrame(window);
  await expect(preview.locator("h1")).toHaveText("Title");
  await expect(preview.locator("strong")).toHaveText("bold");
  await expect(window.locator(".status-bar")).toContainText("6 words");
  await app.close();
});

test("typing updates the preview and autosaves the file", async () => {
  const { app, window, folder } = await launch({ files: { "notes.md": "# Title\n" } });
  const preview = await previewFrame(window);
  await window.locator(".cm-content").click();
  await window.keyboard.press(`${mod}+End`);
  await window.keyboard.type("\nNew line here");
  await expect(preview.locator("p")).toHaveText("New line here");
  await expect(window.locator(".save-status")).toHaveAttribute("data-status", "editing");
  await expect.poll(() => readFileSync(join(folder, "notes.md"), "utf8"), { timeout: 6000 }).toBe("# Title\n\nNew line here");
  await expect(window.locator(".save-status")).toHaveAttribute("data-status", "saved");
  await app.close();
});

test("brackets and markers close themselves", async () => {
  const { app, window } = await launch({ files: { "pairs.md": "" } });
  await window.locator(".cm-content").click();
  await window.keyboard.type("(a) **bold** [link](url) 2 * 3 snake_case");
  await expect(window.locator(".cm-content")).toHaveText("(a) **bold** [link](url) 2 * 3 snake_case");
  await window.keyboard.type(" (");
  await window.keyboard.press("Backspace");
  await expect(window.locator(".cm-content")).toHaveText("(a) **bold** [link](url) 2 * 3 snake_case ");
  await app.close();
});

test("lists continue and end with Return", async () => {
  const { app, window } = await launch({ files: { "list.md": "" } });
  await window.locator(".cm-content").click();
  await window.keyboard.type("- one");
  await window.keyboard.press("Enter");
  await window.keyboard.type("two");
  await window.keyboard.press("Enter");
  await window.keyboard.press("Enter");
  await window.keyboard.type("after");
  const text = await window.locator(".cm-content").innerText();
  // An empty item ends the list and takes its line with it, as in the native editor.
  expect(text).toBe("- one\n- two\nafter");
  await app.close();
});

test("view modes, tabs and the outline", async () => {
  const { app, window } = await launch({
    files: { "a.md": "# One\n\n## Two\n\ntext\n", "b.md": "# Other\n" },
  });
  await expect(window.locator(".tab")).toHaveCount(2);
  await expect(window.locator(".tab.is-selected .tab-title")).toHaveText("b.md");
  await window.locator(".tab").first().click();
  await expect(window.locator(".tab.is-selected .tab-title")).toHaveText("a.md");

  await window.locator('.view-modes button[data-mode="previewOnly"]').click();
  await expect(window.locator(".document:not([hidden]) .panes")).toHaveAttribute("data-mode", "previewOnly");
  await expect(window.locator(".width-button")).not.toHaveClass(/is-out/);
  await window.locator('.view-modes button[data-mode="split"]').click();
  await expect(window.locator(".width-button")).toHaveClass(/is-out/);

  await window.locator(".toolbar-right .glass-button").last().click();
  await expect(window.locator(".outline-row")).toHaveText(["One", "Two"]);
  await window.keyboard.press("Escape");

  await window.locator(".tab").nth(1).click({ button: "middle" });
  await expect(window.locator(".tab")).toHaveCount(0);
  await expect(window.locator(".window-title")).toHaveText("a.md");
  await app.close();
});

/// A click from a test is handed to the page; a click from the mouse reaches
/// it only where the window's drag region leaves off. The region is
/// inherited, so a control under anything still in it, its own glass capsule
/// included, is dead to the mouse however well it answers these clicks.
test("no control in the title bar sits in the window's drag region", async () => {
  const { app, window } = await launch({ files: { "a.md": "# One\n", "b.md": "# Other\n" } });
  await expect(window.locator(".tab")).toHaveCount(2);
  const inTheRegion = await window.evaluate(() => {
    const found: string[] = [];
    for (const element of document.querySelectorAll("#titlebar button, #titlebar .tab, #titlebar .glass, #titlebar input")) {
      for (const pseudo of [undefined, "::before", "::after"]) {
        if (getComputedStyle(element, pseudo).getPropertyValue("-webkit-app-region") === "drag") {
          found.push(`${element.tagName.toLowerCase()}.${element.className}${pseudo ?? ""}`);
        }
      }
    }
    return found;
  });
  expect(inTheRegion).toEqual([]);
  // The bar itself still carries the window: what stays in the region is its
  // empty room, which is what the reader drags.
  const bar = await window.evaluate(() => getComputedStyle(document.getElementById("titlebar")!).getPropertyValue("-webkit-app-region"));
  expect(bar).toBe("drag");
  await app.close();
});

test("find counts matches in the editor and in the preview", async () => {
  const { app, window } = await launch({ files: { "find.md": "apple banana apple\n\nApple pie\n" } });
  await previewFrame(window);
  await window.locator(".cm-content").click();
  await clickMenu(app, "Edit", "Find…");
  await window.keyboard.type("apple");
  await expect(window.locator(".document:not([hidden]) .find-count")).toHaveText("1/3");
  await window.keyboard.press("Enter");
  await expect(window.locator(".document:not([hidden]) .find-count")).toHaveText("2/3");
  await window.keyboard.press("Escape");
  await expect(window.locator(".document:not([hidden]) .find-bar")).toBeHidden();
  await app.close();
});
