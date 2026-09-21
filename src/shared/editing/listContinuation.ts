import { trimmingWhitespaces } from "./characters";
import { lineAt } from "./lines";
import type { TextEdit, TextRange } from "./textEdit";

// Pure logic for continuing and indenting Markdown lists while typing.
//
// The native Coordinator runs it on Return (insertNewline) and on Tab and
// Shift-Tab (insertTab, insertBacktab). newlineEdit and indentEdit below are
// its handleNewline and handleIndent without the text view: an editor applies
// the edit they return in one go, as an undo step of its own, and lets the
// key do what it usually does when they return null.

export interface LineInfo {
  /// UTF-16 length of the full list prefix (indent + marker + spaces + task box).
  prefixLength: number;
  /// UTF-16 length of one indent step (the marker + trailing spaces width).
  indentUnit: number;
}

export type NewlineAction =
  | { kind: "none" }
  /// Empty item: remove its prefix and swallow the newline (ends the list).
  | { kind: "endList"; prefixLength: number }
  /// Item with content: insert newline + the next item's prefix.
  | { kind: "continueList"; insertion: string };

// 1: indent, 2: bullet, 3: number, 4: number delimiter, 5: spaces, 6: task box.
// \p{Nd} where the native pattern says \d, because NSRegularExpression's \d
// takes any script's decimal digits, not only ASCII ones.
const prefixPattern = /^([ \t]*)(?:([-*+])|(\p{Nd}{1,9})([.)]))([ \t]+)(\[[ xX]\][ \t]+)?/u;

/// The list prefix of `line` (without its line break), or null when the line
/// isn't a list item.
export function lineInfo(line: string): LineInfo | null {
  const match = prefixPattern.exec(line);
  if (match === null) return null;
  const task: string | undefined = match[6];
  return {
    prefixLength: match[0].length,
    indentUnit: match[0].length - (match[1]?.length ?? 0) - (task?.length ?? 0),
  };
}

/// What Return does on `line`, which must not include its line break;
/// `caretOffset` is the caret's UTF-16 offset in the line.
export function newlineAction(line: string, caretOffset: number): NewlineAction {
  const match = prefixPattern.exec(line);
  if (match === null) return { kind: "none" };
  const prefixLength = match[0].length;
  if (caretOffset < prefixLength) return { kind: "none" };

  if (trimmingWhitespaces(line.slice(prefixLength)) === "") {
    return { kind: "endList", prefixLength };
  }

  // The indent and the spaces always take part in a match, empty or not;
  // a number and its delimiter come exactly when there is no bullet.
  const indent = match[1] ?? "";
  const bullet: string | undefined = match[2];
  const spaces = match[5] ?? "";
  let prefix =
    bullet !== undefined
      ? indent + bullet + spaces
      : indent + String(nextNumber(match[3] ?? "0")) + (match[4] ?? ".") + spaces;
  if (match[6] !== undefined) {
    prefix += "[ ] ";
  }
  return { kind: "continueList", insertion: "\n" + prefix };
}

/// The number the next item gets. Swift's Int() reads ASCII digits only, so
/// a list numbered in another script's digits continues at 1, as it does in
/// the native editor.
function nextNumber(digits: string): number {
  return (/^[0-9]+$/.test(digits) ? Number(digits) : 0) + 1;
}

/// Return on a list item (the Coordinator's handleNewline): an empty item
/// ends the list, an item with content brings the next one. Null when Return
/// should break the line as usual: there's a selection, the caret is inside
/// the marker, or the line isn't a list item.
export function newlineEdit(text: string, selection: TextRange): TextEdit | null {
  if (selection.length !== 0) return null;
  const line = lineAt(text, selection.location);
  const action = newlineAction(line.text, selection.location - line.start);
  switch (action.kind) {
    case "none":
      return null;
    case "endList":
      return {
        range: { location: line.start, length: action.prefixLength },
        replacement: "",
        selection: { location: line.start, length: 0 },
      };
    case "continueList":
      return {
        range: selection,
        replacement: action.insertion,
        selection: { location: selection.location + action.insertion.length, length: 0 },
      };
  }
}

/// Tab and Shift-Tab with the caret in a list item's prefix (the
/// Coordinator's handleIndent): the item moves in by one indent step of
/// spaces, or out by up to one step of spaces or a single tab. Null when the
/// key should do what it usually does: the line isn't a list item, or the
/// caret is past its prefix. An item already at the margin still takes
/// Shift-Tab, with an edit that changes nothing.
export function indentEdit(text: string, selection: TextRange, outdent: boolean): TextEdit | null {
  const line = lineAt(text, selection.location);
  const info = lineInfo(line.text);
  if (info === null || selection.location - line.start > info.prefixLength) return null;

  if (!outdent) {
    return {
      range: { location: line.start, length: 0 },
      replacement: " ".repeat(info.indentUnit),
      selection: { location: selection.location + info.indentUnit, length: 0 },
    };
  }
  const removable = outdentLength(text, line.start, info.indentUnit);
  return {
    range: { location: line.start, length: removable },
    replacement: "",
    selection:
      removable > 0 ? { location: Math.max(selection.location - removable, line.start), length: 0 } : selection,
  };
}

/// How much of a line's indentation one outdent takes: spaces up to one
/// indent step, or a single tab.
function outdentLength(text: string, lineStart: number, indentUnit: number): number {
  let removable = 0;
  while (removable < indentUnit && lineStart + removable < text.length) {
    const character = text[lineStart + removable];
    if (character === "\t") return removable + 1;
    if (character !== " ") break;
    removable += 1;
  }
  return removable;
}
