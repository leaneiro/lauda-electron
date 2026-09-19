import { describe, expect, it } from "vitest";
import { indentEdit, lineInfo, newlineAction, newlineEdit, type TextEdit } from "../../src/shared/editing";

function apply(edit: TextEdit, text: string): string {
  return text.slice(0, edit.range.location) + edit.replacement + text.slice(edit.range.location + edit.range.length);
}

const caret = (location: number) => ({ location, length: 0 });

describe("ListContinuation", () => {
  it("continues a bullet list", () => {
    expect(newlineAction("- item", 6)).toEqual({ kind: "continueList", insertion: "\n- " });
  });

  it("continues an indented bullet", () => {
    expect(newlineAction("  * sub", 7)).toEqual({ kind: "continueList", insertion: "\n  * " });
  });

  it("increments an ordered list", () => {
    expect(newlineAction("3. passo", 8)).toEqual({ kind: "continueList", insertion: "\n4. " });
  });

  it("keeps the ordered delimiter style", () => {
    expect(newlineAction("1) passo", 8)).toEqual({ kind: "continueList", insertion: "\n2) " });
  });

  it("continues a task list unchecked", () => {
    expect(newlineAction("- [x] done", 10)).toEqual({ kind: "continueList", insertion: "\n- [ ] " });
  });

  it("ends the list on an empty item", () => {
    expect(newlineAction("- ", 2)).toEqual({ kind: "endList", prefixLength: 2 });
  });

  it("ends the list on an empty task item", () => {
    expect(newlineAction("- [ ] ", 6)).toEqual({ kind: "endList", prefixLength: 6 });
  });

  it("does nothing on a line that isn't a list", () => {
    expect(newlineAction("plain text", 5)).toEqual({ kind: "none" });
  });

  it("does nothing with the caret inside the marker", () => {
    expect(newlineAction("- item", 1)).toEqual({ kind: "none" });
  });

  it("doesn't take a horizontal rule for a list", () => {
    expect(newlineAction("---", 3)).toEqual({ kind: "none" });
  });

  it("measures a line's indent unit", () => {
    expect(lineInfo("- item")?.indentUnit).toBe(2);
    expect(lineInfo("10. item")?.indentUnit).toBe(4);
    expect(lineInfo("- [ ] task")?.indentUnit).toBe(2);
    expect(lineInfo("no list")).toBeNull();
  });
});

// The Coordinator's handleNewline and handleIndent, which have no Swift
// tests of their own.
describe("newlineEdit", () => {
  it("brings the next item after one with content", () => {
    const text = "- one\n- two\nafter";
    const edit = newlineEdit(text, caret(11));
    expect(edit).not.toBeNull();
    expect(apply(edit!, text)).toBe("- one\n- two\n- \nafter");
    expect(edit!.selection).toEqual(caret(14));
  });

  it("ends the list on an empty item, taking its prefix and leaving the line", () => {
    const text = "- one\n- ";
    const edit = newlineEdit(text, caret(8));
    expect(apply(edit!, text)).toBe("- one\n");
    expect(edit!.selection).toEqual(caret(6));
  });

  it("leaves Return alone with a selection, outside lists and inside the marker", () => {
    expect(newlineEdit("- item", { location: 2, length: 4 })).toBeNull();
    expect(newlineEdit("plain", caret(5))).toBeNull();
    expect(newlineEdit("- item", caret(1))).toBeNull();
  });
});

describe("indentEdit", () => {
  it("moves an item in by one indent step", () => {
    const text = "a\n1. item";
    const edit = indentEdit(text, caret(5), false);
    expect(apply(edit!, text)).toBe("a\n   1. item");
    expect(edit!.selection).toEqual(caret(8));
  });

  it("leaves Tab alone past the prefix and outside lists", () => {
    expect(indentEdit("- item", caret(4), false)).toBeNull();
    expect(indentEdit("plain", caret(0), false)).toBeNull();
  });

  it("moves an item out by up to one step of spaces", () => {
    const text = "    - item";
    const edit = indentEdit(text, caret(6), true);
    expect(apply(edit!, text)).toBe("  - item");
    expect(edit!.selection).toEqual(caret(4));
  });

  it("takes a single tab out", () => {
    const text = "\t\t- item";
    const edit = indentEdit(text, caret(4), true);
    expect(apply(edit!, text)).toBe("\t- item");
    expect(edit!.selection).toEqual(caret(3));
  });

  it("keeps the caret on its line when it was inside the indentation", () => {
    const text = "x\n    - item";
    const edit = indentEdit(text, caret(3), true);
    expect(apply(edit!, text)).toBe("x\n  - item");
    expect(edit!.selection).toEqual(caret(2));
  });

  it("takes Shift-Tab at the margin without changing anything", () => {
    const selection = { location: 1, length: 3 };
    const edit = indentEdit("- item", selection, true);
    expect(edit).toEqual({ range: caret(0), replacement: "", selection });
  });
});
