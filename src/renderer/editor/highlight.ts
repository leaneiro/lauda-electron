import { RangeSetBuilder, type Text } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { type FenceLine, pairFences } from "../../shared/editing/code";

/// Light regex-based Markdown highlighting for the editor pane, the native
/// MarkdownHighlighter's rules in its order: later rules win where they
/// overlap (inline code inside a heading is purple), and a fenced block
/// resets everything inside it to code.

/// Skipped above this size to keep typing responsive on huge files.
const maxHighlightLength = 150_000;

const word = String.raw`\p{L}\p{M}\p{Nd}\p{Pc}`;
const headingRegex = /^#{1,6}[ \t].*$/gmu;
const listMarkerRegex = /^[ \t]*(?:[-*+]|\d{1,3}[.)])[ \t]/gmu;
const blockquoteRegex = /^[ \t]*>.*$/gmu;
const boldRegex = /(?:\*\*[^*\n]+\*\*|__[^_\n]+__)/gu;
const italicRegex = new RegExp(String.raw`(?<![${word}*])\*(?!\*)[^*\n]+\*(?!\*)|(?<![${word}_])_(?!_)[^_\n]+_(?!_)`, "gu");
const strikethroughRegex = /~~[^~\n]+~~/gu;
/// Underline is written as tags, so the editor shows it the same way.
const underlineRegex = /<u>[^<\n]*<\/u>/giu;
const linkRegex = /\[([^\]\n]*)\]\(([^)\n]*)\)/dgu;
const inlineCodeRegex = /`[^`\n]+`/gu;

type Color = "indigo" | "secondary" | "link" | "tertiary" | "purple";

interface Style {
  color: Color | null;
  bold: boolean;
  italic: boolean;
  struck: boolean;
  underlined: boolean;
  fence: boolean;
}

/// The fenced blocks, found by the same rule as everywhere else
/// (pairFences), over the editor's own lines. Also tells the editor where
/// code is, so typing substitutions and marker pairing stay out of it.
export function fencedBlockRanges(doc: Text): { from: number; to: number }[] {
  function* lines(): Generator<FenceLine> {
    for (let number = 1; number <= doc.lines; number++) {
      const line = doc.line(number);
      yield { start: line.from, next: Math.min(line.to + 1, doc.length), text: line.text };
    }
  }
  return pairFences(lines(), doc.length).map((range) => ({ from: range.location, to: range.location + range.length }));
}

function classes(style: Style): string {
  const names: string[] = [];
  if (style.bold) names.push("md-bold");
  if (style.italic) names.push("md-italic");
  if (style.struck) names.push("md-struck");
  if (style.underlined) names.push("md-underlined");
  if (style.color) names.push(`md-${style.color}`);
  return names.join(" ");
}

/// Styles one line of text, `offset` being where it starts in the document.
function styleLine(text: string, fences: { from: number; to: number }[], offset: number): Style[] {
  const styles: Style[] = Array.from({ length: text.length }, () => ({ color: null, bold: false, italic: false, struck: false, underlined: false, fence: false }));
  const paint = (regex: RegExp, apply: (style: Style) => void, group?: number) => {
    regex.lastIndex = 0;
    for (const match of text.matchAll(regex)) {
      const indices = group !== undefined ? (match as RegExpMatchArray & { indices?: [number, number][] }).indices?.[group] : undefined;
      const start = indices ? indices[0] : match.index ?? 0;
      const end = indices ? indices[1] : start + match[0].length;
      for (let i = start; i < end; i++) apply(styles[i]);
    }
  };
  paint(listMarkerRegex, (s) => (s.color = "indigo"));
  paint(blockquoteRegex, (s) => (s.color = "secondary"));
  paint(boldRegex, (s) => (s.bold = true));
  paint(italicRegex, (s) => (s.italic = true));
  paint(strikethroughRegex, (s) => (s.struck = true));
  paint(underlineRegex, (s) => (s.underlined = true));
  paint(linkRegex, (s) => (s.color = "link"), 1);
  paint(linkRegex, (s) => (s.color = "tertiary"), 2);
  paint(headingRegex, (s) => {
    s.bold = true;
    s.italic = false;
    s.color = "indigo";
  });
  paint(inlineCodeRegex, (s) => (s.color = "purple"));
  for (const fence of fences) {
    const start = Math.max(fence.from - offset, 0);
    const end = Math.min(fence.to - offset, text.length);
    for (let i = start; i < end; i++) styles[i] = { color: "purple", bold: false, italic: false, struck: false, underlined: false, fence: true };
  }
  return styles;
}

function buildDecorations(view: EditorView, fences: { from: number; to: number }[]): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  if (view.state.doc.length > maxHighlightLength) return builder.finish();
  const doc = view.state.doc;
  for (const { from, to } of view.visibleRanges) {
    let position = from;
    while (position <= to) {
      const line = doc.lineAt(position);
      const styles = styleLine(line.text, fences.filter((f) => f.from < line.to + 1 && f.to > line.from), line.from);
      let runStart = 0;
      for (let i = 1; i <= styles.length; i++) {
        const previous = classes(styles[runStart]);
        if (i === styles.length || classes(styles[i]) !== previous) {
          if (previous) builder.add(line.from + runStart, line.from + i, Decoration.mark({ class: previous }));
          runStart = i;
        }
      }
      position = line.to + 1;
    }
  }
  return builder.finish();
}

export const markdownHighlighting = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    fences: { from: number; to: number }[];

    constructor(view: EditorView) {
      this.fences = fencedBlockRanges(view.state.doc);
      this.decorations = buildDecorations(view, this.fences);
    }

    update(update: ViewUpdate) {
      if (update.docChanged) this.fences = fencedBlockRanges(update.state.doc);
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildDecorations(update.view, this.fences);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);
