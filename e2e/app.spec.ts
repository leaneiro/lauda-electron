import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { clickMenu, launch, previewFrame } from "./launch";

const mod = process.platform === "darwin" ? "Meta" : "Control";

test("opens a file and renders its preview", async () => {
  const { app, window } = await launch({ files: { "notes.md": "# Title\n\nA paragraph with **bold** text.\n" } });
  await expect(window.locator(".window-title")).toHaveText("notes.md");
  const preview = await previewFrame(window);
  await expect(preview.locator("h1")).toHaveText("Title");
  await expect(preview.locator("strong")).toHaveText("bold");
  await expect(window.locator(".status-bar")).toContainText("6 words");
  await expect(window.locator(".status-bar")).toContainText("41 characters");
  await app.close();
});

/// An element the document names after a method of the page's takes that
/// method's place on `document`; the preview's script keeps its own.
test("elements named like the page's methods leave the preview working", async () => {
  const { app, window } = await launch({
    files: { "named.md": '<img name="createElement" alt=""><form name="getElementById"></form>\n\n# Title\n' },
  });
  const preview = await previewFrame(window);
  await expect(preview.locator("h1")).toHaveText("Title");
  await window.locator(".cm-content").click();
  await window.keyboard.press(`${mod}+End`);
  await window.keyboard.type("\nStill updating");
  await expect(preview.locator("p").last()).toHaveText("Still updating");
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
  // The counts follow once the typing pauses.
  await expect(window.locator(".status-bar")).toContainText("4 words");
  await expect(window.locator(".status-bar")).toContainText("22 characters");
  await expect
    .poll(() => readFileSync(join(folder, "notes.md"), "utf8"), { timeout: 6000 })
    .toBe("# Title\n\nNew line here");
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

  const outline = window.locator(".toolbar-right .glass-button").last();
  await outline.click();
  await expect(window.locator(".outline-row")).toHaveText(["One", "Two"]);
  await expect(window.locator(".outline-row").first()).toBeFocused();
  await window.keyboard.press("Escape");
  await expect(window.locator(".popover")).toBeHidden();
  // The button opens it again, and a click elsewhere closes it.
  await outline.click();
  await expect(window.locator(".popover")).toBeVisible();
  await window.locator(".document:not([hidden]) .cm-content").click();
  await expect(window.locator(".popover")).toBeHidden();
  // Picking a heading closes it and takes the caret there.
  await outline.click();
  await window.locator(".outline-row", { hasText: "Two" }).click();
  await expect(window.locator(".popover")).toBeHidden();
  await expect
    .poll(() => window.evaluate(() => getSelection()?.anchorNode?.parentElement?.closest(".cm-line")?.textContent))
    .toBe("## Two");

  await window.locator(".tab").nth(1).click({ button: "middle" });
  await expect(window.locator(".tab")).toHaveCount(0);
  await expect(window.locator(".window-title")).toHaveText("a.md");
  await app.close();
});

/// The tabs follow the pattern screen readers know: a list of tabs, the
/// selected one marked and the only stop for Tab, the arrows moving along.
test("the tabs can be read and walked with the keyboard", async () => {
  const { app, window } = await launch({ files: { "a.md": "# A\n", "b.md": "# B\n", "c.md": "# C\n" } });
  const tabs = window.getByRole("tab");
  await expect(tabs).toHaveCount(3);
  await expect(window.getByRole("tablist")).toHaveAccessibleName("Open Documents");
  await expect(window.getByRole("tab", { selected: true })).toHaveAccessibleName("c.md");
  await expect(tabs.nth(0)).toHaveAttribute("tabindex", "-1");
  await expect(tabs.nth(2)).toHaveAttribute("tabindex", "0");

  await tabs.nth(2).focus();
  await window.keyboard.press("ArrowRight");
  await expect(window.getByRole("tab", { selected: true })).toHaveAccessibleName("a.md");
  await expect(tabs.nth(0)).toBeFocused();
  await window.keyboard.press("End");
  await expect(tabs.nth(2)).toBeFocused();
  await window.keyboard.press("ArrowLeft");
  await expect(window.getByRole("tab", { selected: true })).toHaveAccessibleName("b.md");
  await expect(window.locator(".window-title")).toHaveText("b.md");

  await window.keyboard.press("Enter");
  await expect(window.locator(".document:not([hidden]) .cm-content")).toBeFocused();
  await app.close();
});

/// Windows' contrast themes drop translucent fills and shadows, which is all
/// the glass is made of: the capsules keep an outline, and the selected tab
/// and view mode take the system's highlight.
test("high contrast keeps the controls and the selected tab visible", async () => {
  const { app, window } = await launch({ files: { "a.md": "# A\n", "b.md": "# B\n" } });
  await expect(window.getByRole("tab")).toHaveCount(2);
  await window.emulateMedia({ forcedColors: "active" });
  const highlight = await window.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.backgroundColor = "Highlight";
    document.body.append(probe);
    const colour = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return colour;
  });
  await expect(window.getByRole("tab", { selected: true })).toHaveCSS("background-color", highlight);
  await expect(window.getByRole("tab", { selected: false })).toHaveCSS("border-top-width", "1px");
  await expect(window.locator(".view-modes")).toHaveCSS("border-top-width", "1px");
  await expect(window.locator(".toolbar-right .glass-button").last()).toHaveCSS("border-top-width", "1px");
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
    for (const element of document.querySelectorAll(
      "#titlebar button, #titlebar .tab, #titlebar .glass, #titlebar input",
    )) {
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
  const bar = await window.evaluate(() =>
    getComputedStyle(document.getElementById("titlebar")!).getPropertyValue("-webkit-app-region"),
  );
  expect(bar).toBe("drag");
  await app.close();
});

/// The Format menu's four: two Markdown markers, and the tags underline is
/// written with, each shown in the preview as the reader will see it.
test("bold, italic, underline and strikethrough from the Format menu", async () => {
  const { app, window } = await launch({ files: { "format.md": "one two three four\n" } });
  const preview = await previewFrame(window);
  const editor = window.locator(".cm-content");
  await editor.click();

  // Each turn reads the line as it stands, since the markers before a word
  // move it along.
  const wrap = async (word: string, item: string) => {
    const index = (await editor.innerText()).indexOf(word);
    await window.keyboard.press(`${mod}+Home`);
    for (let i = 0; i < index; i++) await window.keyboard.press("ArrowRight");
    for (let i = 0; i < word.length; i++) await window.keyboard.press("Shift+ArrowRight");
    await clickMenu(app, "Format", item);
  };
  await wrap("one", "Bold");
  await wrap("two", "Italic");
  await wrap("three", "Underline");
  await wrap("four", "Strikethrough");

  await expect(editor).toHaveText("**one** *two* <u>three</u> ~~four~~");
  await expect(preview.locator("strong")).toHaveText("one");
  await expect(preview.locator("em")).toHaveText("two");
  await expect(preview.locator("u")).toHaveText("three");
  await expect(preview.locator("del")).toHaveText("four");

  // The same item again takes the formatting off.
  await wrap("three", "Underline");
  await expect(editor).toHaveText("**one** *two* three ~~four~~");
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
