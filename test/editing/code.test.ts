import { describe, expect, it } from "vitest";
import { fencedBlockRanges, isInsideCode } from "../../src/shared/editing";

// The Coordinator's isInsideCode and the highlighter's fencedBlockRanges,
// which the Swift tests reach only through typing.
describe("fencedBlockRanges", () => {
  it("runs from the opening fence's line to past the closing one's break", () => {
    const text = "a\n```js\nx\n```\nb";
    expect(fencedBlockRanges(text)).toEqual([{ location: 2, length: 12 }]);
  });

  it("takes tildes and up to three spaces of indent, and closes any fence with any other", () => {
    expect(fencedBlockRanges("   ~~~\nx\n```")).toEqual([{ location: 0, length: 12 }]);
    expect(fencedBlockRanges("    ```\nx")).toEqual([]);
  });

  it("runs an unclosed fence to the end of the text", () => {
    expect(fencedBlockRanges("a\n```\nb\nc")).toEqual([{ location: 2, length: 7 }]);
  });
});

describe("isInsideCode", () => {
  it("is in a fenced block from its first line's start to past its last line", () => {
    const text = "```\nx\n```\nafter";
    expect(isInsideCode(text, 0)).toBe(true);
    expect(isInsideCode(text, 4)).toBe(true);
    expect(isInsideCode(text, 10)).toBe(false);
  });

  it("is in inline code after an odd number of backticks on the line", () => {
    const text = "`a` b `c\nd";
    expect(isInsideCode(text, 2)).toBe(true);
    expect(isInsideCode(text, 4)).toBe(false);
    expect(isInsideCode(text, 8)).toBe(true);
    expect(isInsideCode(text, 10)).toBe(false);
  });

  it("uses the fenced blocks it's given", () => {
    expect(isInsideCode("plain", 2, [{ location: 0, length: 5 }])).toBe(true);
    expect(isInsideCode("```\nx", 4, [])).toBe(false);
  });
});
