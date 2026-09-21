// @vitest-environment jsdom
//
// The anchor lines must pair one for one with the elements preview.js's
// anchorElements() collects from the rendered HTML, or lineAnchors() gives
// up and scroll sync falls back to proportions. These tests parse the HTML
// in a DOM and walk it the way the preview does.
import { describe, expect, it } from "vitest";
import { renderWithLines } from "../../src/shared/markdown";

/// preview.js's anchorElements(): every top-level block, then the list items
/// and table rows inside it; nothing inside raw HTML.
function anchorElements(html: string): Element[] {
  const content = document.createElement("article");
  content.innerHTML = html;
  const elements: Element[] = [];
  for (const block of Array.from(content.children)) {
    elements.push(block);
    if (block.classList.contains("raw")) continue;
    for (const inner of Array.from(block.querySelectorAll("li, tr"))) elements.push(inner);
  }
  return elements;
}

/// Each anchor element's tag with the source line it's paired with.
function anchors(markdown: string): [string, number][] {
  const { html, anchorLines } = renderWithLines(markdown);
  const elements = anchorElements(html);
  expect(elements.length).toBe(anchorLines.length);
  return elements.map((element, index) => [element.tagName.toLowerCase(), anchorLines[index] ?? -1]);
}

describe("anchor lines", () => {
  it("follow nested list items in document order", () => {
    expect(anchors("- a\n  - b\n  - c\n- d\n\n1. x\n2. y")).toEqual([
      ["ul", 0],
      ["li", 0],
      ["li", 1],
      ["li", 2],
      ["li", 3],
      ["ol", 5],
      ["li", 5],
      ["li", 6],
    ]);
  });

  it("anchor task items like any other item", () => {
    expect(anchors("- [ ] a\n- [x] b\n  more")).toEqual([
      ["ul", 0],
      ["li", 0],
      ["li", 1],
    ]);
  });

  it("anchor a table's head row and each body row", () => {
    expect(anchors("| h | i |\n| - | - |\n| 1 | 2 |\n| 3 |\n\nafter")).toEqual([
      ["table", 0],
      ["tr", 0],
      ["tr", 2],
      ["tr", 3],
      ["p", 5],
    ]);
  });

  it("give a table that grew out of a paragraph the paragraph's line", () => {
    // cmark splits the paragraph off above the table without a position,
    // so it takes the line of the anchor before it.
    expect(anchors("# T\ntext\n| a |\n| - |\n| 1 |")).toEqual([
      ["h1", 0],
      ["p", 0],
      ["table", 1],
      ["tr", 1],
      ["tr", 4],
    ]);
  });

  it("find rows and items inside block quotes and list items", () => {
    expect(anchors("> - a\n> - b\n\n- item\n\n  | a |\n  | - |\n  | 1 |")).toEqual([
      ["blockquote", 0],
      ["li", 0],
      ["li", 1],
      ["ul", 3],
      ["li", 3],
      ["tr", 5],
      ["tr", 7],
    ]);
  });

  it("keep raw HTML blocks as one element, whatever they hold", () => {
    expect(
      anchors("<ul><li>raw</li></ul>\n<table><tr><td>x</td></tr></table>\n\ntext\n\n<!-- note -->\n\n- real"),
    ).toEqual([
      ["div", 0],
      ["p", 3],
      ["div", 5],
      ["ul", 7],
      ["li", 7],
    ]);
  });

  it("pair every block of a mixed document", () => {
    const markdown = [
      "# Title",
      "",
      "Intro with *emphasis*",
      "and a second line.",
      "",
      "> quote",
      "",
      "```swift",
      "let x = 1",
      "```",
      "",
      "---",
      "",
      "1. one",
      "2. two",
      "   - nested",
      "",
      "<div>raw</div>",
      "",
      "| a |",
      "| - |",
      "| 1 |",
      "",
      "[ref]: https://example.com",
      "",
      "Last [link][ref].",
    ].join("\n");
    expect(anchors(markdown)).toEqual([
      ["h1", 0],
      ["p", 2],
      ["blockquote", 5],
      ["pre", 7],
      ["hr", 11],
      ["ol", 13],
      ["li", 13],
      ["li", 14],
      ["li", 15],
      ["div", 17],
      ["table", 19],
      ["tr", 19],
      ["tr", 21],
      ["p", 25],
    ]);
  });

  it("are empty for an empty document", () => {
    expect(anchors("")).toEqual([]);
  });
});
