// The document tree the renderer and the outline walk: the shape of
// swift-markdown's tree (what the native app renders from), so the renderer
// reads like HTMLRenderer.swift and the parser has one target to match.

/// 0-based source line a node starts on, or null when cmark made the node
/// up and gave it no position (the paragraph it splits off above a table).
export type SourceLine = number | null;

export type ColumnAlignment = "left" | "center" | "right";

export interface Document {
  readonly kind: "document";
  readonly children: BlockMarkup[];
}

export interface Paragraph {
  readonly kind: "paragraph";
  readonly line: SourceLine;
  readonly children: InlineMarkup[];
}

export interface Heading {
  readonly kind: "heading";
  readonly line: SourceLine;
  readonly level: number;
  readonly children: InlineMarkup[];
}

export interface BlockQuote {
  readonly kind: "blockQuote";
  readonly line: SourceLine;
  readonly children: BlockMarkup[];
}

export interface UnorderedList {
  readonly kind: "unorderedList";
  readonly line: SourceLine;
  readonly children: ListItem[];
}

export interface OrderedList {
  readonly kind: "orderedList";
  readonly line: SourceLine;
  readonly startIndex: number;
  readonly children: ListItem[];
}

export interface ListItem {
  readonly kind: "listItem";
  readonly line: SourceLine;
  /// null for an item that isn't a task.
  readonly checkbox: "checked" | "unchecked" | null;
  readonly children: BlockMarkup[];
}

export interface CodeBlock {
  readonly kind: "codeBlock";
  readonly line: SourceLine;
  /// The whole info string, as swift-markdown reports it ("swift title=x"),
  /// or null when there is none.
  readonly language: string | null;
  /// Every line ends with "\n", as cmark keeps it.
  readonly code: string;
}

export interface HTMLBlock {
  readonly kind: "htmlBlock";
  readonly line: SourceLine;
  readonly rawHTML: string;
}

export interface ThematicBreak {
  readonly kind: "thematicBreak";
  readonly line: SourceLine;
}

export interface Table {
  readonly kind: "table";
  readonly line: SourceLine;
  readonly columnAlignments: (ColumnAlignment | null)[];
  readonly head: TableHead;
  /// Every row has exactly as many cells as the head, as cmark completes
  /// short rows and drops the cells past the last column.
  readonly rows: TableRow[];
}

export interface TableHead {
  readonly kind: "tableHead";
  readonly line: SourceLine;
  readonly cells: TableCell[];
}

export interface TableRow {
  readonly kind: "tableRow";
  readonly line: SourceLine;
  readonly cells: TableCell[];
}

export interface TableCell {
  readonly kind: "tableCell";
  readonly children: InlineMarkup[];
}

export interface Text {
  readonly kind: "text";
  readonly string: string;
}

export interface SoftBreak {
  readonly kind: "softBreak";
}

export interface LineBreak {
  readonly kind: "lineBreak";
}

export interface InlineCode {
  readonly kind: "inlineCode";
  readonly code: string;
}

export interface InlineHTML {
  readonly kind: "inlineHTML";
  readonly rawHTML: string;
}

export interface Emphasis {
  readonly kind: "emphasis";
  readonly children: InlineMarkup[];
}

export interface Strong {
  readonly kind: "strong";
  readonly children: InlineMarkup[];
}

export interface Strikethrough {
  readonly kind: "strikethrough";
  readonly children: InlineMarkup[];
}

export interface Link {
  readonly kind: "link";
  /// null when empty, as swift-markdown reports `[text]()`.
  readonly destination: string | null;
  readonly title: string | null;
  readonly children: InlineMarkup[];
}

export interface Image {
  readonly kind: "image";
  readonly source: string | null;
  readonly title: string | null;
  /// The alt text as parsed inlines, which `plainText` flattens.
  readonly children: InlineMarkup[];
}

export type BlockMarkup =
  | Paragraph
  | Heading
  | BlockQuote
  | UnorderedList
  | OrderedList
  | ListItem
  | CodeBlock
  | HTMLBlock
  | ThematicBreak
  | Table;

export type InlineMarkup =
  | Text
  | SoftBreak
  | LineBreak
  | InlineCode
  | InlineHTML
  | Emphasis
  | Strong
  | Strikethrough
  | Link
  | Image;

export type Markup = Document | BlockMarkup | TableHead | TableRow | TableCell | InlineMarkup;

/// A node's children in swift-markdown's order: a table holds its head,
/// then its rows.
export function childrenOf(markup: Markup): readonly Markup[] {
  switch (markup.kind) {
    case "table":
      return [markup.head, ...markup.rows];
    case "tableHead":
    case "tableRow":
      return markup.cells;
    case "document":
    case "paragraph":
    case "heading":
    case "blockQuote":
    case "unorderedList":
    case "orderedList":
    case "listItem":
    case "tableCell":
    case "emphasis":
    case "strong":
    case "strikethrough":
    case "link":
    case "image":
      return markup.children;
    default:
      return [];
  }
}

/// swift-markdown's `plainText` of inline content: inline code keeps its
/// backticks, a soft break reads as a space and raw HTML as itself.
export function plainText(markup: InlineMarkup): string {
  switch (markup.kind) {
    case "text":
      return markup.string;
    case "softBreak":
      return " ";
    case "lineBreak":
      return "\n";
    case "inlineCode":
      return `\`${markup.code}\``;
    case "inlineHTML":
      return markup.rawHTML;
    default:
      return markup.children.map(plainText).join("");
  }
}
