// Renders the Markdown tree to HTML for the preview pane (HTMLRenderer.swift).
// The output matches the native app's character for character, since the
// preview's script diffs it block by block and aligns the scroll on it.

import { highlightCode } from "./code-highlighter";
import { allowedLinkSchemes } from "./content-policy";
import { escapeHTML } from "./escape";
import {
  childrenOf,
  plainText,
  type BlockMarkup,
  type CodeBlock,
  type ColumnAlignment,
  type Image,
  type Link,
  type ListItem,
  type Markup,
  type OrderedList,
  type Table,
} from "./markup";
import { parseDocument } from "./parser";
import { sourceLineCount } from "./source-lines";

export interface RenderOptions {
  /// CommonMark behavior: a single Enter inside a paragraph folds into a
  /// space. Off by default, where every Enter is a visible line break.
  readonly strictLineBreaks?: boolean;
}

export interface RenderedDocument {
  readonly html: string;
  /// 0-based source line of each element the preview anchors its scroll on.
  readonly anchorLines: number[];
  readonly lineCount: number;
}

export function render(markdown: string, options: RenderOptions = {}): string {
  return new HTMLRenderer(options.strictLineBreaks ?? false).visit(parseDocument(markdown));
}

/// Preview rendering plus the 0-based source lines the preview anchors its
/// scroll on, in the order it walks the DOM: every top-level block,
/// followed by the list items and table rows inside it.
///
/// Anchoring inside blocks is what keeps long lists aligned. Between two
/// anchors the preview can only interpolate by line number, while the
/// rendered height of each line depends on how its text wraps at the
/// current width, so a document made of a few huge blocks (a list of
/// hundreds of items) drifted the more the window narrowed.
export function renderWithLines(markdown: string, options: RenderOptions = {}): RenderedDocument {
  const document = parseDocument(markdown);
  const renderer = new HTMLRenderer(options.strictLineBreaks ?? false);
  let html = "";
  const anchorLines: number[] = [];
  for (const child of document.children) {
    const piece = renderer.visit(child);
    // Raw HTML can hold zero or several top-level elements; a wrapper keeps
    // the one-element-per-block correspondence. Its class tells the preview
    // not to look for anchors inside, where the elements are the
    // document's own and map to no source line of ours.
    html += child.kind === "htmlBlock" ? `<div class="raw">${piece}</div>\n` : piece;
    anchorLines.push(child.line ?? lastOf(anchorLines));
    if (child.kind !== "htmlBlock") appendInnerAnchors(child, anchorLines);
  }
  return { html, anchorLines, lineCount: sourceLineCount(markdown) };
}

function lastOf(anchorLines: readonly number[]): number {
  return anchorLines[anchorLines.length - 1] ?? 0;
}

/// Source lines of the list items and table rows inside a block, in
/// document order: the same order the preview's `anchorElements()` walks
/// them in, which pairs each line with the element's measured position.
function appendInnerAnchors(markup: Markup, anchorLines: number[]): void {
  for (const child of childrenOf(markup)) {
    // A table's head renders as the row inside <thead>.
    if (child.kind === "listItem" || child.kind === "tableHead" || child.kind === "tableRow") {
      anchorLines.push(child.line ?? lastOf(anchorLines));
    }
    appendInnerAnchors(child, anchorLines);
  }
}

/// Print-oriented rendering: each top-level heading is wrapped together
/// with an invisible probe that reserves a couple of lines below it.
/// `break-inside: avoid` on the wrapper then pushes the heading to the next
/// page instead of leaving it orphaned at the bottom (WebKit's print engine
/// ignores `break-after: avoid`, so this is the reliable route).
export function renderForPrint(markdown: string, options: RenderOptions = {}): string {
  const children = parseDocument(markdown).children;
  const renderer = new HTMLRenderer(options.strictLineBreaks ?? false);
  let html = "";
  let index = 0;
  while (index < children.length) {
    if (children[index].kind !== "heading") {
      html += renderer.visit(children[index]);
      index += 1;
      continue;
    }
    let group = renderer.visit(children[index]);
    index += 1;
    while (index < children.length && children[index].kind === "heading") {
      group += renderer.visit(children[index]);
      index += 1;
    }
    if (index < children.length && avoidsInnerBreaks(children[index])) {
      // The next block is itself unbreakable (pre/table/quote): if it
      // doesn't fit it would jump to the next page alone, stranding the
      // heading above an empty gap, so they travel as one unit.
      group += renderer.visit(children[index]);
      index += 1;
      html += `<div class="keep-with-next">${group}</div>\n`;
    } else {
      html += `<div class="keep-with-next keep-pad">${group}<div class="keep-probe"></div></div>\n`;
    }
  }
  return html;
}

/// Blocks styled with `break-inside: avoid` in the print stylesheet. Long
/// code blocks are allowed to flow across pages, so only compact ones
/// travel glued to their heading.
function avoidsInnerBreaks(markup: BlockMarkup): boolean {
  if (markup.kind === "codeBlock") return codeBlockLineCount(markup) <= compactCodeBlockLineLimit;
  return markup.kind === "table" || markup.kind === "blockQuote";
}

/// Code blocks up to this many lines never split across PDF pages (small
/// enough that moving them whole costs little); longer ones flow freely,
/// which avoids large end-of-page gaps.
export const compactCodeBlockLineLimit = 6;

export function codeBlockLineCount(codeBlock: CodeBlock): number {
  const lines = codeBlock.code.split("\n").length;
  return codeBlock.code.endsWith("\n") ? lines - 1 : lines;
}

/// Relative links, fragments and the external schemes the app opens.
/// Anything else (javascript:, data:, file:…) is dropped, keeping the text.
export function isAllowedLinkDestination(destination: string): boolean {
  // Browsers skip whitespace and control characters inside a scheme.
  const text = Array.from(destination)
    .filter((character) => {
      const value = character.codePointAt(0)!;
      return value > 0x20 && value !== 0x7f;
    })
    .join("");
  const colon = text.indexOf(":");
  if (colon === -1) return true;
  const scheme = text.slice(0, colon);
  // A colon after a path, query or fragment separator isn't a scheme.
  if (/[/?#]/.test(scheme)) return true;
  return allowedLinkSchemes.has(scheme.toLowerCase());
}

// MARK: - Visitor

class HTMLRenderer {
  constructor(private readonly strictLineBreaks: boolean) {}

  visit(markup: Markup): string {
    switch (markup.kind) {
      case "heading":
        return `<h${markup.level}>${this.childrenHTML(markup)}</h${markup.level}>\n`;
      case "paragraph":
        return `<p>${this.childrenHTML(markup)}</p>\n`;
      case "text":
        return escapeHTML(markup.string);
      case "emphasis":
        return `<em>${this.childrenHTML(markup)}</em>`;
      case "strong":
        return `<strong>${this.childrenHTML(markup)}</strong>`;
      case "strikethrough":
        return `<del>${this.childrenHTML(markup)}</del>`;
      case "inlineCode":
        return `<code>${escapeHTML(markup.code)}</code>`;
      case "codeBlock":
        return this.codeBlock(markup);
      case "link":
        return this.link(markup);
      case "image":
        return this.image(markup);
      case "unorderedList":
        return `<ul>\n${this.childrenHTML(markup)}</ul>\n`;
      case "orderedList":
        return this.orderedList(markup);
      case "listItem":
        return this.listItem(markup);
      case "blockQuote":
        return `<blockquote>\n${this.childrenHTML(markup)}</blockquote>\n`;
      case "thematicBreak":
        return "<hr>\n";
      case "table":
        return this.table(markup);
      // By default every Enter is a visible line break (GitHub-comment /
      // Obsidian style); strict mode keeps CommonMark's fold-into-a-space.
      case "softBreak":
        return this.strictLineBreaks ? "\n" : "<br>\n";
      case "lineBreak":
        return "<br>\n";
      case "htmlBlock":
      case "inlineHTML":
        return markup.rawHTML;
      default:
        return this.childrenHTML(markup);
    }
  }

  private childrenHTML(markup: Markup): string {
    return childrenOf(markup).map((child) => this.visit(child)).join("");
  }

  private codeBlock(codeBlock: CodeBlock): string {
    const keepClass = codeBlockLineCount(codeBlock) <= compactCodeBlockLineLimit ? ' class="keep"' : "";
    const languageClass = codeBlock.language !== null ? ` class="language-${escapeHTML(codeBlock.language)}"` : "";
    const body = highlightCode(codeBlock.code, codeBlock.language) ?? escapeHTML(codeBlock.code);
    return `<pre${keepClass}><code${languageClass}>${body}</code></pre>\n`;
  }

  private link(link: Link): string {
    const content = this.childrenHTML(link);
    if (link.destination === null || !isAllowedLinkDestination(link.destination)) return content;
    return `<a href="${escapeHTML(link.destination)}">${content}</a>`;
  }

  private image(image: Image): string {
    const source = escapeHTML(image.source ?? "");
    const alt = escapeHTML(image.children.map(plainText).join(""));
    const title = image.title !== null ? ` title="${escapeHTML(image.title)}"` : "";
    return `<img src="${source}" alt="${alt}"${title}>`;
  }

  private orderedList(orderedList: OrderedList): string {
    const start = orderedList.startIndex > 1 ? ` start="${orderedList.startIndex}"` : "";
    return `<ol${start}>\n${this.childrenHTML(orderedList)}</ol>\n`;
  }

  private listItem(listItem: ListItem): string {
    let prefix = "";
    let cssClass = "";
    if (listItem.checkbox !== null) {
      const checked = listItem.checkbox === "checked" ? " checked" : "";
      prefix = `<input type="checkbox" disabled${checked}> `;
      cssClass = ' class="task"';
    }

    // swift-markdown always wraps item content in a Paragraph (tightness is
    // not exposed), so unwrap the leading paragraph for the classic tight
    // list rendering; any following blocks keep their own tags.
    let inner = "";
    const [first, ...rest] = listItem.children;
    if (first?.kind === "paragraph") {
      inner = this.childrenHTML(first);
      for (const child of rest) inner += "\n" + this.visit(child);
    } else {
      inner = listItem.children.map((child) => this.visit(child)).join("");
    }
    return `<li${cssClass}>${prefix}${inner}</li>\n`;
  }

  private table(table: Table): string {
    const style = (column: number): string => alignmentStyle(table.columnAlignments[column] ?? null);
    let html = "<table>\n<thead>\n<tr>";
    table.head.cells.forEach((cell, column) => {
      html += `<th${style(column)}>${this.childrenHTML(cell)}</th>`;
    });
    html += "</tr>\n</thead>\n<tbody>\n";
    for (const row of table.rows) {
      html += "<tr>";
      row.cells.forEach((cell, column) => {
        html += `<td${style(column)}>${this.childrenHTML(cell)}</td>`;
      });
      html += "</tr>\n";
    }
    html += "</tbody>\n</table>\n";
    return html;
  }
}

function alignmentStyle(alignment: ColumnAlignment | null): string {
  return alignment === null ? "" : ` style="text-align:${alignment}"`;
}
