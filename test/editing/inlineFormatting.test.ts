import { describe, expect, it } from "vitest";
import { boldMarker, italicMarker, link, toggle, type TextEdit } from "../../src/shared/editing";

function apply(edit: TextEdit, text: string): string {
  return text.slice(0, edit.range.location) + edit.replacement + text.slice(edit.range.location + edit.range.length);
}

describe("InlineFormatting", () => {
  it("inserts an empty pair with the caret inside when the caret is outside a word", () => {
    const text = "one  two";
    const edit = toggle("**", text, { location: 4, length: 0 }, { location: 3, length: 2 });
    expect(apply(edit, text)).toBe("one **** two");
    expect(edit.selection).toEqual({ location: 6, length: 0 });
  });

  it("wraps the word the caret is in", () => {
    const text = "say hello now";
    const edit = toggle("**", text, { location: 6, length: 0 }, { location: 4, length: 5 });
    expect(apply(edit, text)).toBe("say **hello** now");
    expect(edit.selection).toEqual({ location: 6, length: 5 });
  });

  it("unwraps a selection that includes the markers", () => {
    const text = "a **bold** b";
    const selection = { location: 2, length: 8 };
    const edit = toggle("**", text, selection, selection);
    expect(apply(edit, text)).toBe("a bold b");
    expect(edit.selection).toEqual({ location: 2, length: 4 });
  });

  it("removes markers just outside the selection", () => {
    const text = "a **bold** b";
    const selection = { location: 4, length: 4 };
    const edit = toggle("**", text, selection, selection);
    expect(apply(edit, text)).toBe("a bold b");
    expect(edit.selection).toEqual({ location: 2, length: 4 });
  });

  it("wraps a plain selection", () => {
    const text = "make it italic";
    const selection = { location: 8, length: 6 };
    const edit = toggle("*", text, selection, selection);
    expect(apply(edit, text)).toBe("make it *italic*");
    expect(edit.selection).toEqual({ location: 9, length: 6 });
  });

  it("takes a link's URL from the clipboard", () => {
    const text = "see docs here";
    const edit = link(text, { location: 4, length: 4 }, " https://example.com ");
    expect(apply(edit, text)).toBe("see [docs](https://example.com) here");
    expect(edit.selection).toEqual({ location: 11, length: 19 });
  });

  it("leaves the caret in the parentheses without a URL", () => {
    const text = "see docs here";
    const edit = link(text, { location: 4, length: 4 }, "not a url");
    expect(apply(edit, text)).toBe("see [docs]() here");
    expect(edit.selection).toEqual({ location: 11, length: 0 });
  });

  it("puts the caret in the brackets with nothing selected", () => {
    const text = "x";
    const edit = link(text, { location: 1, length: 0 }, null);
    expect(apply(edit, text)).toBe("x[]()");
    expect(edit.selection).toEqual({ location: 2, length: 0 });
  });

  it("uses ** for bold and * for italic, as ⌘B and ⌘I do", () => {
    expect(boldMarker).toBe("**");
    expect(italicMarker).toBe("*");
  });
});
