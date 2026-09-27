import type { Input } from "electron";

/// Ctrl+Tab and Ctrl+Shift+Tab walk the tabs, as in browsers: the command a
/// key press stands for, when it is one of them.
export function tabKeyCommand(
  input: Pick<Input, "type" | "key" | "control" | "shift" | "alt" | "meta">,
): "next-tab" | "previous-tab" | null {
  if (input.type !== "keyDown" || input.key !== "Tab" || !input.control || input.alt || input.meta) return null;
  return input.shift ? "previous-tab" : "next-tab";
}
