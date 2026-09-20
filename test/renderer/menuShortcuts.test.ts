// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { standardKeymap } from "@codemirror/commands";
import { searchKeymap } from "@codemirror/search";
import type { KeyBinding } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { editorBindings, historyBindings } from "../../src/renderer/editor/behaviors";

/// A binding in the editor wins over a menu's shortcut: it runs first and
/// says the key is spoken for, so the menu item never fires however well it
/// is registered. ⌘U went that way once, taken by undoing a selection.

/// Electron's accelerators in CodeMirror's terms ("CmdOrCtrl+Shift+X" is
/// "Mod-Shift-x"), lower-cased, since CodeMirror matches keys that way.
function asBinding(accelerator: string): string {
  return accelerator
    .split("+")
    .map((part) => (part === "CmdOrCtrl" || part === "Cmd" ? "Mod" : part))
    .map((part, index, parts) => (index === parts.length - 1 ? part.toLowerCase() : part))
    .join("-");
}

/// What the editor actually installs (editor.ts and behaviors.ts).
const installed: KeyBinding[] = [
  ...standardKeymap,
  ...historyBindings,
  ...editorBindings,
  ...searchKeymap.filter((binding) => binding.key === "Escape"),
];

describe("menu shortcuts", () => {
  it("are left alone by the editor's own bindings", () => {
    const menu = readFileSync(join(process.cwd(), "src/main/menu.ts"), "utf8");
    const accelerators = [...menu.matchAll(/accelerator: "([^"]+)"/g)].map((match) => match[1]);
    expect(accelerators.length).toBeGreaterThan(10);
    const wanted = new Set(accelerators.map(asBinding));
    // Select All is the one the editor shares with the menu, and does the
    // same thing on both sides.
    wanted.delete("Mod-a");

    const taken = installed
      .map((binding) => binding.mac ?? binding.key)
      .filter((key): key is string => typeof key === "string" && wanted.has(key));
    expect(taken).toEqual([]);
  });
});
