// OutlineTests.swift, with the same expected values.
import { describe, expect, it } from "vitest";
import { outlineItems } from "../../src/shared/markdown";

describe("outline", () => {
  it("collects headings with levels, titles and lines", () => {
    const markdown = [
      "# Title",
      "",
      "text",
      "",
      "## Section *one*",
      "",
      "Sub",
      "---",
      "",
      "```",
      "# not a heading",
      "```",
      "",
      "### Three",
    ].join("\n");
    const items = outlineItems(markdown);
    expect(items.map((item) => item.level)).toEqual([1, 2, 2, 3]);
    expect(items.map((item) => item.title)).toEqual(["Title", "Section one", "Sub", "Three"]);
    expect(items.map((item) => item.line)).toEqual([0, 4, 6, 13]);
    expect(items.map((item) => item.id)).toEqual([0, 1, 2, 3]);
  });

  it("supports all six levels", () => {
    const items = outlineItems("# 1\n## 2\n### 3\n#### 4\n##### 5\n###### 6\n####### 7 is not a heading");
    expect(items.map((item) => item.level)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("skips empty headings", () => {
    expect(outlineItems("#\n\n## Real").map((item) => item.title)).toEqual(["Real"]);
  });

  // The welcome guide sets the app's name in a styled span; the outline
  // lists the words, not the tags.
  it("leaves inline HTML tags out of titles", () => {
    const items = outlineItems('# Welcome to <span class="wordmark">Lauda</span> 👋\n\n## Plain *emphasis*');
    expect(items.map((item) => item.title)).toEqual(["Welcome to Lauda 👋", "Plain emphasis"]);
  });

  it("is empty for a document without headings", () => {
    expect(outlineItems("just text\n\n- list")).toEqual([]);
  });

  // Beyond the Swift tests.

  it("keeps inline code's backticks and the typographer's quotes in titles", () => {
    expect(outlineItems('## The `render` "API"').map((item) => item.title)).toEqual(["The `render` “API”"]);
  });

  it("lists headings inside block quotes and list items", () => {
    expect(outlineItems("> # Quoted\n\n- ## Listed").map((item) => [item.title, item.line]))
      .toEqual([["Quoted", 0], ["Listed", 2]]);
  });
});
