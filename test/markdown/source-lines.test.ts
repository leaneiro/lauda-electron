// SourceLinesTests.swift, with the same expected values.
import { describe, expect, it } from "vitest";
import { sourceLineContaining, sourceLineCount, sourceLineStarts } from "../../src/shared/markdown";

describe("source lines", () => {
  it.each([["", 1], ["a", 1], ["a\nb", 2], ["a\nb\n", 3]])("counts newlines + 1 in %j", (text, expected) => {
    expect(sourceLineCount(text)).toBe(expected);
  });

  it("reports line starts as UTF-16 offsets", () => {
    expect(sourceLineStarts("ab\ncafé\n\nx")).toEqual([0, 3, 8, 9]);
  });

  it.each([[0, 0], [2, 0], [3, 1], [7, 2], [50, 3]])("finds offset %i on line %i", (offset, line) => {
    expect(sourceLineContaining(offset, [0, 3, 7, 8])).toBe(line);
  });
});
