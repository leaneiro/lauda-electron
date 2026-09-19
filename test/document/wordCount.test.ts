import { describe, expect, it, test } from "vitest";
import { characterCount, countWords, readingTime, wordCount } from "../../src/shared/document";

describe("WordCount", () => {
  it("counts English words and ignores punctuation", () => {
    expect(wordCount("Hello world, this is a test.")).toBe(6);
    expect(wordCount("one two  three\n\nfour")).toBe(4);
  });

  it("doesn't count Markdown markers as words", () => {
    expect(wordCount("# Title\n\n- item one\n- **bold** word")).toBe(5);
  });

  it("finds no words in empty text", () => {
    expect(wordCount("")).toBe(0);
    expect(wordCount("  \n\n - ")).toBe(0);
  });

  /// Japanese and Chinese have no spaces between words; splitting on
  /// whitespace would count a whole sentence as one word.
  it.each(["今日は良い天気です。", "我们今天去公园散步。"])("counts words in languages without spaces: %s", (sentence) => {
    const count = wordCount(sentence);
    expect(count).toBeGreaterThan(2);
    expect(count).toBeLessThan(characterCount(sentence));
  });
});

// The status bar's character count (Swift's String.count), which has no
// Swift test of its own.
describe("characterCount", () => {
  it("counts what a reader sees as one character once", () => {
    expect(characterCount("")).toBe(0);
    expect(characterCount("abc")).toBe(3);
    expect(characterCount("cafe\u{301}")).toBe(4);
    expect(characterCount("👍🏽 ok")).toBe(4);
    expect(characterCount("a\r\nb")).toBe(3);
  });
});

describe("ReadingTime", () => {
  it("shows nothing for an empty document", () => {
    expect(readingTime(0)).toBeNull();
  });

  it("shows less than one minute for short text", () => {
    expect(readingTime(50)).toEqual({ kind: "lessThanOneMinute" });
  });

  it.each([
    [200, 1],
    [350, 2],
    [1000, 5],
  ])("rounds %i words to the nearest minute: %i", (words, minutes) => {
    expect(readingTime(words)).toEqual({ kind: "minutes", minutes });
  });

  it("rounds half a minute up, as Swift's rounded() does", () => {
    expect(readingTime(100)).toEqual({ kind: "minutes", minutes: 1 });
    expect(readingTime(300)).toEqual({ kind: "minutes", minutes: 2 });
  });
});

describe("joining words a segmenter split at a full stop", () => {
  const segments = (...parts: [string, boolean][]) => parts.map(([segment, isWordLike]) => ({ segment, isWordLike }));

  test("letters around a full stop, an apostrophe or a colon are one word", () => {
    expect(countWords(segments(["example", true], [".", false], ["com", true]))).toBe(1);
    expect(countWords(segments(["nome", true], [".", false], ["count", true], ["(", false]))).toBe(1);
    expect(countWords(segments(["don", true], ["’", false], ["t", true]))).toBe(1);
  });

  test("digits around a full stop or a comma are one number", () => {
    expect(countWords(segments(["3", true], [".", false], ["14", true]))).toBe(1);
    expect(countWords(segments(["1", true], [",", false], ["000", true]))).toBe(1);
  });

  test("a comma between words, or a space, still separates them", () => {
    expect(countWords(segments(["one", true], [",", false], ["two", true]))).toBe(2);
    expect(countWords(segments(["end", true], [".", false], [" ", false], ["Next", true]))).toBe(2);
    expect(countWords(segments(["a", true], [".", false], [".", false], ["b", true]))).toBe(2);
  });

  test("a letter word and a number around a full stop stay two", () => {
    expect(countWords(segments(["item", true], [".", false], ["2", true]))).toBe(2);
  });

  test("the reference document counts as the native app counts it", () => {
    const text = "Um [link](https://example.com). print(nome.count)\n1. Um\n";
    expect(wordCount(text)).toBe(8);
  });
});
