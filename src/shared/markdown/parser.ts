// Parses Markdown into the tree swift-markdown builds for the native app
// (Document(parsing:)). micromark implements the same CommonMark and GFM
// specs as cmark-gfm, which swift-markdown wraps, so the two trees mostly
// agree already. This module sets micromark up the way swift-markdown sets
// up cmark and then fills the gaps: cmark's smart punctuation, its own rule
// for task list items, its table spans, and the details swift-markdown
// exposes (the whole info string of a code block, literals ending in "\n",
// empty destinations read as none).

import { fromMarkdown } from "mdast-util-from-markdown";
import type { CompileContext, Extension, Options, Token } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import type * as mdast from "mdast";
import type {
  BlockMarkup,
  CodeBlock,
  Document,
  InlineMarkup,
  ListItem,
  SourceLine,
  Table,
  TableCell,
} from "./markup";
import { smartPunctuation, type Piece, type Replacement, type SmartSource } from "./smart-punctuation";

/// Parses `markdown` into the tree the native renderer walks.
export function parseDocument(markdown: string): Document {
  const provenance = new Provenance(markdown);
  const tree = fromMarkdown(markdown, {
    extensions: micromarkExtensions,
    mdastExtensions: [...gfmTreeExtensions, provenanceExtension(provenance)],
  });
  return new Converter(markdown, provenance, definitions(tree)).document(tree);
}

// MARK: - Parser setup

type MicromarkExtension = NonNullable<Options["extensions"]>[number];

/// swift-markdown attaches cmark-gfm's table, strikethrough and tasklist
/// extensions and nothing else: bare URLs stay text and footnotes aren't
/// parsed. Task items follow cmark's own rule (see `taskCheckbox`), which
/// micromark's check doesn't match, so that construct is off as well.
const disabledConstructs: MicromarkExtension = {
  disable: {
    null: [
      "wwwAutolink", "protocolAutolink", "emailAutolink",
      "gfmFootnoteDefinition", "gfmFootnoteCall", "gfmPotentialFootnoteCall",
      "tasklistCheck",
    ],
  },
};

const micromarkExtensions: MicromarkExtension[] = [gfm(), disabledConstructs];

/// The GFM tree extensions for what stays on. The autolink one is left out
/// because it also links bare URLs in a pass of its own, after parsing.
const gfmTreeExtensions: Extension[] = gfmFromMarkdown().filter(
  (extension) => extension.transforms === undefined && !("taskListCheckValueChecked" in (extension.exit ?? {})),
);

// MARK: - Provenance

interface FencedCode {
  /// Everything between the fences, before the parser trims the first and
  /// last line endings: the only way to tell an empty block from a block
  /// of one empty line.
  raw?: string;
  infoEnd?: number;
  metaStart?: number;
}

interface Fragment {
  type: "fragment";
  children: mdast.PhrasingContent[];
}

/// What the tree alone doesn't say but cmark's output depends on: which
/// characters of a text node were typed as such (smart punctuation leaves
/// escapes and entities alone), where its soft line endings are, an image's
/// alt text as inlines, and a fenced code block's raw content and info.
class Provenance implements SmartSource {
  private readonly literalPieces = new Map<mdast.Text, Piece[]>();
  private readonly lineEndingPieces = new Map<mdast.Text, Piece[]>();
  private readonly altInlines = new Map<mdast.Image | mdast.ImageReference, mdast.PhrasingContent[]>();
  private readonly fenced = new Map<mdast.Code, FencedCode>();

  constructor(readonly markdown: string) {}

  literals(node: mdast.Text): readonly Piece[] {
    return this.literalPieces.get(node) ?? [];
  }

  lineEndings(node: mdast.Text): readonly Piece[] {
    return this.lineEndingPieces.get(node) ?? [];
  }

  altChildren(node: mdast.Image | mdast.ImageReference): readonly mdast.PhrasingContent[] {
    return this.altInlines.get(node) ?? [];
  }

  fencedCode(node: mdast.Code): FencedCode | undefined {
    return this.fenced.get(node);
  }

  addLiteral(node: mdast.Text, start: number, end: number, source: number): void {
    const pieces = this.literalPieces.get(node) ?? [];
    const last = pieces[pieces.length - 1];
    // Adjacent tokens of one run of text read as one piece, so a run of
    // dashes split between tokens still counts whole.
    if (last && last.end === start && last.source + (last.end - last.start) === source) {
      pieces[pieces.length - 1] = { start: last.start, end, source: last.source };
    } else {
      pieces.push({ start, end, source });
    }
    this.literalPieces.set(node, pieces);
  }

  addLineEnding(node: mdast.Text, start: number, end: number, source: number): void {
    const pieces = this.lineEndingPieces.get(node) ?? [];
    pieces.push({ start, end, source });
    this.lineEndingPieces.set(node, pieces);
  }

  setAltChildren(node: mdast.Image, children: mdast.PhrasingContent[]): void {
    this.altInlines.set(node, children);
  }

  fencedCodeRecord(node: mdast.Code): FencedCode {
    let record = this.fenced.get(node);
    if (!record) {
      record = {};
      this.fenced.set(node, record);
    }
    return record;
  }

  /// Drops the first `count` characters of a text node's value.
  dropLeading(node: mdast.Text, count: number): void {
    node.value = node.value.slice(count);
    const shift = (pieces: Piece[] | undefined): Piece[] =>
      (pieces ?? [])
        .filter((piece) => piece.end > count)
        .map((piece) => ({
          start: Math.max(piece.start - count, 0),
          end: piece.end - count,
          source: piece.source + Math.max(count - piece.start, 0),
        }));
    this.literalPieces.set(node, shift(this.literalPieces.get(node)));
    this.lineEndingPieces.set(node, shift(this.lineEndingPieces.get(node)));
  }
}

type Point = NonNullable<mdast.Node["position"]>["start"];

function pointOf(point: Token["end"]): Point {
  return { line: point.line, column: point.column, offset: point.offset };
}

function top<T>(context: CompileContext): T {
  return context.stack[context.stack.length - 1] as unknown as T;
}

/// Handlers that replace from-markdown's own for a few tokens: each does
/// what the original does and notes what `Provenance` keeps.
///
/// Doing what the original does means leaning on its insides (this.data's
/// atHardBreak, this.config's canContainEols), which a minor release may
/// change without a word. That is why package.json pins micromark,
/// mdast-util-from-markdown and the GFM extensions to exact versions: an
/// update is a deliberate step, taken with the cmark compatibility tests.
function provenanceExtension(provenance: Provenance): Extension {
  return {
    exit: {
      data(token) {
        const tail = this.stack.pop() as mdast.Text;
        const start = tail.value.length;
        tail.value += this.sliceSerialize(token);
        tail.position!.end = pointOf(token.end);
        provenance.addLiteral(tail, start, tail.value.length, token.start.offset);
      },
      lineEnding(token) {
        const context = top<mdast.Parent>(this);
        // A hard break takes its line ending in.
        if (this.data.atHardBreak) {
          const lastChild = context.children.at(-1);
          if (lastChild?.position) lastChild.position.end = pointOf(token.end);
          this.data.atHardBreak = undefined;
          return;
        }
        if (this.data.setextHeadingSlurpLineEnding || !this.config.canContainEols.includes(context.type)) return;
        let tail = context.children[context.children.length - 1];
        if (tail?.type !== "text") {
          tail = { type: "text", value: "", position: { start: pointOf(token.start), end: pointOf(token.end) } };
          context.children.push(tail);
        }
        const text = tail as mdast.Text;
        const start = text.value.length;
        text.value += this.sliceSerialize(token);
        text.position!.end = pointOf(token.end);
        provenance.addLineEnding(text, start, text.value.length, token.start.offset);
      },
      label() {
        const fragment = top<Fragment>(this);
        const value = this.resume();
        const node = top<mdast.Link | mdast.Image>(this);
        this.data.inReference = true;
        if (node.type === "link") {
          node.children = fragment.children;
        } else {
          node.alt = value;
          provenance.setAltChildren(node, fragment.children);
        }
      },
      codeFenced(token) {
        const raw = this.resume();
        const node = top<mdast.Code>(this);
        node.value = raw.replace(/^(\r?\n|\r)|(\r?\n|\r)$/g, "");
        this.data.flowCodeInside = undefined;
        provenance.fencedCodeRecord(node).raw = raw;
        this.exit(token);
      },
      codeFencedFenceInfo(token) {
        const value = this.resume();
        const node = top<mdast.Code>(this);
        node.lang = value;
        provenance.fencedCodeRecord(node).infoEnd = token.end.offset;
      },
      codeFencedFenceMeta(token) {
        const value = this.resume();
        const node = top<mdast.Code>(this);
        node.meta = value;
        provenance.fencedCodeRecord(node).metaStart = token.start.offset;
      },
    },
  };
}

/// Link reference definitions by identifier; the first one of a label wins.
function definitions(tree: mdast.Root): Map<string, mdast.Definition> {
  const found = new Map<string, mdast.Definition>();
  const visit = (nodes: readonly mdast.Nodes[]): void => {
    for (const node of nodes) {
      if (node.type === "definition") {
        if (!found.has(node.identifier)) found.set(node.identifier, node);
      } else if (node.type === "blockquote" || node.type === "list" || node.type === "listItem") {
        visit(node.children);
      }
    }
  };
  visit(tree.children);
  return found;
}

// MARK: - Conversion

function lineOf(node: mdast.Node): SourceLine {
  return node.position ? node.position.start.line - 1 : null;
}

/// cmark ends every line it keeps with "\n", whatever the file used.
function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

class Converter {
  constructor(
    private readonly markdown: string,
    private readonly provenance: Provenance,
    private readonly definitions: ReadonlyMap<string, mdast.Definition>,
  ) {}

  document(tree: mdast.Root): Document {
    return { kind: "document", children: this.blocks(tree.children) };
  }

  private blocks(nodes: readonly mdast.RootContent[]): BlockMarkup[] {
    const blocks: BlockMarkup[] = [];
    nodes.forEach((node, index) => {
      const block = this.block(node, nodes, index);
      if (block) blocks.push(block);
    });
    return blocks;
  }

  private block(node: mdast.RootContent, siblings: readonly mdast.RootContent[], index: number): BlockMarkup | null {
    const previous = siblings[index - 1];
    const next = siblings[index + 1];
    switch (node.type) {
      case "paragraph":
        return {
          kind: "paragraph",
          // cmark reads a table's header row as the last line of a
          // paragraph, then splits the lines above into a new paragraph,
          // which has no position.
          line: next?.type === "table" && isSplitAbove(node, next) ? null : paragraphStart(siblings, index),
          children: this.inlines(node.children),
        };
      case "heading":
        return {
          kind: "heading",
          // A setext heading is a paragraph that met its underline.
          line: isSetext(node) ? paragraphStart(siblings, index) : lineOf(node),
          level: node.depth,
          children: this.inlines(node.children),
        };
      case "thematicBreak":
        return { kind: "thematicBreak", line: lineOf(node) };
      case "blockquote":
        return { kind: "blockQuote", line: lineOf(node), children: this.blocks(node.children) };
      case "list": {
        const children = node.children.map((item) => this.listItem(item));
        return node.ordered
          ? { kind: "orderedList", line: lineOf(node), startIndex: node.start ?? 1, children }
          : { kind: "unorderedList", line: lineOf(node), children };
      }
      case "code":
        return this.codeBlock(node);
      case "html": {
        // cmark keeps each line with its "\n"; micromark leaves out the
        // last one unless the block runs to the end of the document.
        const html = normalizeLineEndings(node.value);
        return { kind: "htmlBlock", line: lineOf(node), rawHTML: html.endsWith("\n") ? html : html + "\n" };
      }
      case "table": {
        // The table keeps the position of the paragraph it grew out of.
        const line = previous?.type === "paragraph" && isSplitAbove(previous, node)
          ? paragraphStart(siblings, index - 1)
          : lineOf(node);
        return this.table(node, line);
      }
      default:
        // Link reference definitions leave no node, as in cmark.
        return null;
    }
  }

  private listItem(item: mdast.ListItem): ListItem {
    const checkbox = this.taskCheckbox(item);
    return { kind: "listItem", line: lineOf(item), checkbox, children: this.blocks(item.children) };
  }

  /// cmark-gfm's tasklist rule, which differs from micromark's: the item's
  /// whole source line, from its first column, must read as a list marker,
  /// then `[ ]`, `[x]` or `[X]` with a space or tab on both sides. So an
  /// item inside a block quote is never a task, and neither is one whose
  /// box ends its line. The item counts as checked when "[x]" or "[X]"
  /// appears anywhere on that line (cmark looks it up with strstr).
  private taskCheckbox(item: mdast.ListItem): ListItem["checkbox"] {
    const start = item.position?.start.offset;
    const paragraph = item.children[0];
    if (start === undefined || paragraph?.type !== "paragraph") return null;
    const line = sourceLine(this.markdown, start);
    const prefix = /^[ \t\v\f]*(?:[-+*]|[0-9]+[^\n])[ \t\v\f]+(?=\[[ xX]\][ \t\v\f])/.exec(line.text);
    if (!prefix) return null;
    const box = line.start + prefix[0].length;
    if (paragraph.position?.start.offset !== box || !this.removeCheckbox(paragraph, box)) return null;
    if (paragraph.children.length === 0) item.children.shift();
    return /\[[xX]\]/.test(line.text) ? "checked" : "unchecked";
  }

  /// Takes the box out of the item's first paragraph, which then starts at
  /// the first character after it, as cmark's does. Returns false when the
  /// paragraph doesn't start with the box as parsed.
  private removeCheckbox(paragraph: mdast.Paragraph, box: number): boolean {
    const head = paragraph.children[0];
    if (head?.type === "text" && head.position?.start.offset === box && /^\[[ xX]\]/.test(head.value)) {
      this.provenance.dropLeading(head, 3);
    } else if (head?.type === "linkReference" && head.position?.start.offset === box && head.position.end.offset === box + 3) {
      // `[x]` read as a link, because the document defines "x".
      paragraph.children.shift();
    } else {
      return false;
    }
    this.trimLeadingBlank(paragraph);
    return true;
  }

  /// Drops typed spaces, line endings and trailing-space hard breaks from
  /// the start of a paragraph.
  private trimLeadingBlank(paragraph: mdast.Paragraph): void {
    for (;;) {
      const head = paragraph.children[0];
      if (head?.type === "text") {
        const literal = this.provenance.literals(head).find((piece) => piece.start === 0);
        const lineEnding = this.provenance.lineEndings(head).find((piece) => piece.start === 0);
        const spaces = literal ? /^[ \t]*/.exec(head.value.slice(0, literal.end))![0].length : 0;
        if (spaces > 0) {
          this.provenance.dropLeading(head, spaces);
        } else if (lineEnding) {
          this.provenance.dropLeading(head, lineEnding.end);
        } else if (head.value.length === 0) {
          paragraph.children.shift();
        } else {
          const first = this.provenance.literals(head).find((piece) => piece.start === 0);
          if (first && head.position) head.position.start = { ...head.position.start, offset: first.source };
          return;
        }
      } else if (head?.type === "break" && this.markdown[head.position?.start.offset ?? 0] !== "\\") {
        paragraph.children.shift();
      } else {
        return;
      }
    }
  }

  private codeBlock(node: mdast.Code): CodeBlock {
    const fenced = this.provenance.fencedCode(node);
    const value = normalizeLineEndings(node.value);
    let code = value.length > 0 ? value + "\n" : "";
    if (value.length === 0 && fenced?.raw !== undefined) {
      // One line ending follows the opening fence; each empty line inside
      // adds one more.
      const lineEndings = fenced.raw.match(/\r\n|\r|\n/g)?.length ?? 0;
      code = "\n".repeat(Math.max(lineEndings - 1, 0));
    }
    return { kind: "codeBlock", line: lineOf(node), language: fenced ? this.infoString(node, fenced) : null, code };
  }

  /// cmark's info string: the whole text after the fence, trimmed, where
  /// micromark splits it into a language and the rest.
  private infoString(node: mdast.Code, fenced: FencedCode): string | null {
    const gap = fenced.infoEnd !== undefined && fenced.metaStart !== undefined
      ? this.markdown.slice(fenced.infoEnd, fenced.metaStart)
      : "";
    const info = ((node.lang ?? "") + gap + (node.meta ?? "")).replace(/[ \t\r\n]+$/, "");
    return info.length > 0 ? info : null;
  }

  private table(node: mdast.Table, line: SourceLine): Table {
    const [head, ...body] = node.children;
    const columns = head?.children.length ?? 0;
    const column = <T>(make: (index: number) => T): T[] => Array.from({ length: columns }, (_, index) => make(index));
    // With CMARK_OPT_TABLE_SPANS, a body cell holding just `^` merges into
    // the cell above; cmark empties it, and the renderer shows it empty.
    const markers = [head, ...body].map((row) => column((index) => isRowSpanMarker(row?.children[index], this.markdown)));
    return {
      kind: "table",
      line,
      columnAlignments: column((index) => node.align?.[index] ?? null),
      head: { kind: "tableHead", line, cells: column((index) => this.cell(head?.children[index])) },
      rows: body.map((row, rowIndex) => ({
        kind: "tableRow",
        line: lineOf(row),
        cells: column((index) => {
          const spansUp = markers[rowIndex + 1]?.[index] && markers.slice(0, rowIndex + 1).some((above) => !above[index]);
          return this.cell(spansUp ? undefined : row.children[index]);
        }),
      })),
    };
  }

  private cell(cell: mdast.TableCell | undefined): TableCell {
    return { kind: "tableCell", children: cell ? this.inlines(cell.children) : [] };
  }

  // MARK: Inlines

  private inlines(children: mdast.PhrasingContent[]): InlineMarkup[] {
    return this.phrasing(children, smartPunctuation(children, this.provenance));
  }

  private phrasing(nodes: readonly mdast.PhrasingContent[], smart: Map<mdast.Text, Replacement[]>): InlineMarkup[] {
    return nodes.flatMap((node) => this.inline(node, smart));
  }

  private inline(node: mdast.PhrasingContent, smart: Map<mdast.Text, Replacement[]>): InlineMarkup[] {
    switch (node.type) {
      case "text":
        return this.text(node, smart.get(node) ?? []);
      case "emphasis":
        return [{ kind: "emphasis", children: this.phrasing(node.children, smart) }];
      case "strong":
        return [{ kind: "strong", children: this.phrasing(node.children, smart) }];
      case "delete":
        return [{ kind: "strikethrough", children: this.phrasing(node.children, smart) }];
      case "inlineCode":
        // Line endings inside a code span read as spaces. cmark has already
        // dropped the indentation of the line that follows, micromark not.
        return [{ kind: "inlineCode", code: node.value.replace(/(?:\r\n|\r|\n)[ \t]*/g, " ") }];
      case "break":
        return [{ kind: "lineBreak" }];
      case "html":
        return [{ kind: "inlineHTML", rawHTML: normalizeLineEndings(node.value) }];
      case "link":
        return [{ kind: "link", ...target(node), children: this.phrasing(node.children, smart) }];
      case "linkReference":
        return [{ kind: "link", ...target(this.definitions.get(node.identifier)), children: this.phrasing(node.children, smart) }];
      case "image":
        return this.image(node, target(node), smart);
      case "imageReference":
        return this.image(node, target(this.definitions.get(node.identifier)), smart);
      default:
        return [];
    }
  }

  private image(
    node: mdast.Image | mdast.ImageReference,
    { destination, title }: { destination: string | null; title: string | null },
    smart: Map<mdast.Text, Replacement[]>,
  ): InlineMarkup[] {
    const altNodes = this.provenance.altChildren(node);
    const children = this.phrasing(altNodes, smart);
    // cmark-gfm keeps `![^` for footnotes: the `!` stays text and the rest
    // reads as a link. A link can't hold another, so that only works when
    // the alt text has none.
    const start = node.position?.start.offset;
    if (start !== undefined && this.markdown.startsWith("![^", start) && !children.some(holdsLink)) {
      return [{ kind: "text", string: "!" }, { kind: "link", destination, title, children }];
    }
    return [{ kind: "image", source: destination, title, children }];
  }

  /// A text node as cmark splits it: text runs with the smart punctuation
  /// applied, and a break for each line ending it holds.
  private text(node: mdast.Text, replacements: readonly Replacement[]): InlineMarkup[] {
    const lineEndings = this.provenance.lineEndings(node);
    const result: InlineMarkup[] = [];
    let run = "";
    const flush = (): void => {
      if (run.length > 0) result.push({ kind: "text", string: run });
      run = "";
    };
    let index = 0;
    let nextLineEnding = 0;
    let nextReplacement = 0;
    while (index < node.value.length) {
      const lineEnding = lineEndings[nextLineEnding];
      if (lineEnding && lineEnding.start === index) {
        flush();
        result.push({ kind: this.isHardBreak(lineEnding.source) ? "lineBreak" : "softBreak" });
        index = lineEnding.end;
        nextLineEnding += 1;
        continue;
      }
      const replacement = replacements[nextReplacement];
      if (replacement && replacement.index === index) {
        run += replacement.text;
        index += replacement.length;
        nextReplacement += 1;
        continue;
      }
      run += node.value[index];
      index += 1;
    }
    flush();
    return result;
  }

  /// cmark breaks the line hard whenever the two characters before the line
  /// ending are spaces, even after a tab, where micromark sees trailing
  /// whitespace ("a\t  \nb").
  private isHardBreak(lineEndingOffset: number): boolean {
    return this.markdown[lineEndingOffset - 1] === " " && this.markdown[lineEndingOffset - 2] === " ";
  }
}

/// The line cmark's paragraph starts on: link reference definitions right
/// above it, with no blank line between, were lines of the same paragraph
/// until cmark took them out, and the paragraph keeps their position.
function paragraphStart(siblings: readonly mdast.RootContent[], index: number): SourceLine {
  let first = siblings[index];
  if (!first) return null;
  for (const sibling of siblings.slice(0, index).reverse()) {
    const touches = sibling.position !== undefined && first.position !== undefined
      && sibling.position.end.line + 1 === first.position.start.line;
    if (sibling.type !== "definition" || !touches) break;
    first = sibling;
  }
  return lineOf(first);
}

/// Whether a heading was underlined: ATX headings take one line.
function isSetext(heading: mdast.Heading): boolean {
  return heading.position !== undefined && heading.position.end.line > heading.position.start.line;
}

/// Whether `table` starts on the line right after `paragraph`: in cmark it
/// grew out of that paragraph.
function isSplitAbove(paragraph: mdast.Paragraph, table: mdast.Table): boolean {
  const end = paragraph.position?.end.line;
  const start = table.position?.start.line;
  return end !== undefined && start !== undefined && end + 1 === start;
}

function holdsLink(markup: InlineMarkup): boolean {
  if (markup.kind === "link") return true;
  return "children" in markup && markup.children.some(holdsLink);
}

/// Whether a cell's source is exactly `^`.
function isRowSpanMarker(cell: mdast.TableCell | undefined, markdown: string): boolean {
  const only = cell?.children.length === 1 ? cell.children[0] : undefined;
  if (only?.type !== "text" || only.value !== "^" || !only.position) return false;
  return markdown.slice(only.position.start.offset, only.position.end.offset) === "^";
}

/// A link's destination and title, where swift-markdown reads empty as none.
function target(node: { url: string; title?: string | null } | undefined): { destination: string | null; title: string | null } {
  return { destination: node?.url || null, title: node?.title || null };
}

/// The whole source line holding `offset`, split on any line ending.
function sourceLine(markdown: string, offset: number): { start: number; text: string } {
  let start = offset;
  while (start > 0 && markdown[start - 1] !== "\n" && markdown[start - 1] !== "\r") start -= 1;
  let end = offset;
  while (end < markdown.length && markdown[end] !== "\n" && markdown[end] !== "\r") end += 1;
  return { start, text: markdown.slice(start, end) };
}
