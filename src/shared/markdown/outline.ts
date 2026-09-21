import { trimmingWhitespaces } from "../editing/characters";
// The document outline (Outline.swift): the headings the toolbar's popover
// lists, with the source line picking one scrolls both panes to.

import { childrenOf, type Heading, type Markup, plainText } from "./markup";
import { parseDocument } from "./parser";

/// A heading in the document outline.
export interface OutlineItem {
  readonly id: number;
  readonly level: number;
  readonly title: string;
  /// 0-based source line, the same numbering scroll sync uses.
  readonly line: number;
}

/// Every heading with a title, in document order, block quotes and list
/// items included.
export function outlineItems(markdown: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  const visit = (markup: Markup): void => {
    if (markup.kind === "heading") {
      const title = trimmingWhitespaces(outlineTitle(markup));
      if (title.length > 0 && markup.line !== null) {
        items.push({ id: items.length, level: markup.level, title, line: markup.line });
      }
      return;
    }
    for (const child of childrenOf(markup)) visit(child);
  };
  visit(parseDocument(markdown));
  return items;
}

/// A heading's text as the outline shows it: like `plainText`, but raw
/// HTML tags are left out, so `<span class="wordmark">Lauda</span>` reads
/// as "Lauda".
export function outlineTitle(heading: Heading): string {
  const text = (markup: Markup): string => {
    if (markup.kind === "inlineHTML") return "";
    const children = childrenOf(markup);
    if (children.length > 0) return children.map(text).join("");
    return isInline(markup) ? plainText(markup) : "";
  };
  return text(heading);
}

function isInline(markup: Markup): markup is Parameters<typeof plainText>[0] {
  switch (markup.kind) {
    case "text":
    case "softBreak":
    case "lineBreak":
    case "inlineCode":
    case "emphasis":
    case "strong":
    case "strikethrough":
    case "link":
    case "image":
      return true;
    default:
      return false;
  }
}
