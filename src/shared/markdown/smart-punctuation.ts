// cmark's CMARK_OPT_SMART, which swift-markdown turns on and micromark
// doesn't have: straight quotes curl, "--" and "---" become dashes and "..."
// an ellipsis. It runs on the parsed inlines of one paragraph, heading or
// table cell and reproduces cmark's inline parser (inlines.c): only
// characters typed as such are touched, never escaped ones or entities, and
// quotes follow the same flanking rules and delimiter stack as emphasis.

import type { Image, ImageReference, PhrasingContent, Text } from "mdast";

/// A run of a text node's value that came from one source token: value
/// indices [start, end) and the source offset of `start`.
export interface Piece {
  readonly start: number;
  readonly end: number;
  readonly source: number;
}

/// What the smart pass needs to know about the parsed text.
export interface SmartSource {
  readonly markdown: string;
  /// Pieces typed in the source (micromark's `data` tokens), in order.
  literals(node: Text): readonly Piece[];
  /// Soft line endings kept in the value, in order.
  lineEndings(node: Text): readonly Piece[];
  /// An image's alt text as parsed inlines.
  altChildren(node: Image | ImageReference): readonly PhrasingContent[];
}

/// Replaces value[index, index + length) with `text`.
export interface Replacement {
  readonly index: number;
  readonly length: number;
  readonly text: string;
}

const leftSingleQuote = "‘";
const rightSingleQuote = "’";
const leftDoubleQuote = "“";
const rightDoubleQuote = "”";
const enDash = "–";
const emDash = "—";
const ellipsis = "…";

/// A single quote on cmark's delimiter stack.
interface QuoteDelimiter {
  readonly source: number;
  readonly canOpen: boolean;
  readonly canClose: boolean;
  /// End offsets of the emphasis, strong and strikethrough spans around the
  /// quote: closing one removes the quote from the stack, so a closer past
  /// it can no longer pair with it.
  readonly enclosingEnds: readonly number[];
  readonly replace: (text: string) => void;
}

/// The replacements, per text node, that cmark's smart punctuation makes in
/// the inline content `children` of one block.
export function smartPunctuation(children: readonly PhrasingContent[], source: SmartSource): Map<Text, Replacement[]> {
  const replacements = new Map<Text, Replacement[]>();
  if (children.length === 0) return replacements;
  const content = {
    start: children[0]?.position?.start.offset ?? 0,
    end: children.at(-1)?.position?.end.offset ?? source.markdown.length,
  };
  const add = (node: Text, replacement: Replacement): void => {
    const list = replacements.get(node);
    if (list) list.push(replacement);
    else replacements.set(node, [replacement]);
  };

  // Links and images process their own delimiters when they close (cmark's
  // stack_bottom), so each one is a scope of its own.
  const scopes: QuoteDelimiter[][] = [];
  const walk = (nodes: readonly PhrasingContent[], scope: QuoteDelimiter[], enclosingEnds: readonly number[]): void => {
    for (const node of nodes) {
      switch (node.type) {
        case "text":
          scanText(node, scope, enclosingEnds);
          break;
        case "emphasis":
        case "strong":
        case "delete":
          walk(node.children, scope, [...enclosingEnds, node.position?.end.offset ?? Infinity]);
          break;
        case "link":
        case "linkReference":
          walk(node.children, newScope(), []);
          break;
        case "image":
        case "imageReference":
          walk(source.altChildren(node), newScope(), []);
          break;
        default:
          break;
      }
    }
  };
  const newScope = (): QuoteDelimiter[] => {
    const scope: QuoteDelimiter[] = [];
    scopes.push(scope);
    return scope;
  };

  const scanText = (node: Text, scope: QuoteDelimiter[], enclosingEnds: readonly number[]): void => {
    const lineEndings = source.lineEndings(node);
    const isLineEnding = (index: number): boolean =>
      lineEndings.some((piece) => index >= piece.start && index < piece.end);
    const value = node.value;
    const markdown = source.markdown;

    // The characters around a quote as cmark's inline parser sees them: the
    // block's raw content, where each line starts after its container
    // prefix and indentation, and the content's ends read as newlines.
    // Tildes don't count: the strikethrough extension registers `~` as a
    // character that delimiters look past (cmark-gfm's skip_chars).
    const before = (index: number, offset: number): string => {
      if (index > 0 && isLineEnding(index - 1)) return "\n";
      let position = offset;
      while (position > content.start && markdown[position - 1] === "~") position -= 1;
      if (position <= content.start || startsLineContent(markdown, position)) return "\n";
      return characterBefore(markdown, position);
    };
    const after = (index: number, offset: number): string => {
      if (index + 1 < value.length && isLineEnding(index + 1)) return "\n";
      let position = offset + 1;
      while (position < content.end && markdown[position] === "~") position += 1;
      if (position >= content.end) return "\n";
      return characterAt(markdown, position);
    };

    for (const piece of source.literals(node)) {
      let index = piece.start;
      while (index < piece.end) {
        const character = value[index];
        const offset = piece.source + (index - piece.start);
        if (character === "-" || character === ".") {
          let run = 1;
          while (index + run < piece.end && value[index + run] === character) run += 1;
          if (character === "-" && run > 1) {
            add(node, { index, length: run, text: dashes(run) });
          } else if (character === ".") {
            for (let group = 0; group + 3 <= run; group += 3) {
              add(node, { index: index + group, length: 3, text: ellipsis });
            }
          }
          index += run;
          continue;
        }
        if (character === '"' || character === "'") {
          const flanking = quoteFlanking(before(index, offset), after(index, offset));
          if (character === '"') {
            add(node, { index, length: 1, text: flanking.canClose ? rightDoubleQuote : leftDoubleQuote });
          } else {
            const replacement: { index: number; length: number; text: string } = {
              index,
              length: 1,
              text: rightSingleQuote,
            };
            add(node, replacement);
            if (flanking.canOpen || flanking.canClose) {
              scope.push({
                source: offset,
                ...flanking,
                enclosingEnds,
                replace: (text) => {
                  replacement.text = text;
                },
              });
            }
          }
        }
        index += 1;
      }
    }
  };

  walk(children, newScope(), []);
  for (const scope of scopes) matchSingleQuotes(scope);
  for (const list of replacements.values()) list.sort((a, b) => a.index - b.index);
  return replacements;
}

/// cmark's process_emphasis for single quotes: every quote starts as a
/// right quote (an apostrophe), and each closer turns the nearest opener
/// still on the stack into a left quote, taking both off the stack.
function matchSingleQuotes(delimiters: readonly QuoteDelimiter[]): void {
  const matched = new Set<QuoteDelimiter>();
  let openersBottom = -Infinity;
  delimiters.forEach((closer, closerIndex) => {
    if (!closer.canClose) return;
    for (let index = closerIndex - 1; index >= 0; index -= 1) {
      const opener = delimiters[index];
      if (!opener || opener.source < openersBottom) break;
      if (!opener.canOpen || matched.has(opener)) continue;
      if (opener.enclosingEnds.some((end) => end <= closer.source)) continue;
      opener.replace(leftSingleQuote);
      matched.add(opener);
      return;
    }
    openersBottom = closer.source;
  });
}

/// handle_hyphen: a multiple of three is all em dashes, an even count all en
/// dashes, and otherwise em dashes followed by one or two en dashes.
function dashes(count: number): string {
  let em = 0;
  let en = 0;
  if (count % 3 === 0) {
    em = count / 3;
  } else if (count % 2 === 0) {
    en = count / 2;
  } else if (count % 3 === 2) {
    en = 1;
    em = (count - 2) / 3;
  } else {
    en = 2;
    em = (count - 4) / 3;
  }
  return emDash.repeat(em) + enDash.repeat(en);
}

/// scan_delims for a quote.
function quoteFlanking(before: string, after: string): { canOpen: boolean; canClose: boolean } {
  const leftFlanking = !isSpace(after) && (!isPunctuation(after) || isSpace(before) || isPunctuation(before));
  const rightFlanking = !isSpace(before) && (!isPunctuation(before) || isSpace(after) || isPunctuation(after));
  return {
    canOpen: leftFlanking && !rightFlanking && before !== "]" && before !== ")",
    canClose: rightFlanking,
  };
}

/// cmark_utf8proc_is_space: tab, line feed, form feed, carriage return and
/// the space separators.
function isSpace(character: string): boolean {
  return /^[\t\n\f\r\p{Zs}]$/u.test(character);
}

/// cmark_utf8proc_is_punctuation: ASCII punctuation and Unicode's P
/// categories. cmark's table predates a hundred or so punctuation marks of
/// rare scripts that `\p{P}` knows, and still counts U+166D.
function isPunctuation(character: string): boolean {
  return /^[!-/:-@[-`{-~\p{P}᙭]$/u.test(character);
}

/// Whether only container prefixes (indentation, `>`) precede `offset` on
/// its line: the character starts that line's content, which cmark's
/// inline parser sees right after a newline.
function startsLineContent(markdown: string, offset: number): boolean {
  for (let index = offset - 1; index >= 0; index -= 1) {
    const character = markdown[index];
    if (character === "\n" || character === "\r") return true;
    if (character !== " " && character !== "\t" && character !== ">") return false;
  }
  return true;
}

function characterBefore(text: string, offset: number): string {
  if (offset <= 0) return "\n";
  const low = text.charCodeAt(offset - 1);
  if (low >= 0xdc00 && low <= 0xdfff && offset >= 2) {
    const high = text.charCodeAt(offset - 2);
    if (high >= 0xd800 && high <= 0xdbff) return text.slice(offset - 2, offset);
  }
  return text[offset - 1] ?? "\n";
}

function characterAt(text: string, offset: number): string {
  const point = text.codePointAt(offset);
  return point === undefined ? "\n" : String.fromCodePoint(point);
}
