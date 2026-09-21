// SourceLinesTests.swift, with the same expected values.
import { describe, expect, it } from "vitest";
import { sourceLineCount } from "../../src/shared/markdown";

describe("source lines", () => {
  it.each([
    ["", 1],
    ["a", 1],
    ["a\nb", 2],
    ["a\nb\n", 3],
  ])("counts newlines + 1 in %j", (text, expected) => {
    expect(sourceLineCount(text)).toBe(expected);
  });
});
