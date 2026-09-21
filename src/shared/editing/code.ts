import { lineStart } from "./lines";
import { locationInRange, type TextRange } from "./textEdit";

/// Whether `location` is in code, where Markdown's markers are plain
/// characters and `->` is meant literally: inside a fenced block, or after an
/// odd number of backticks on its line (inline code, closed or not yet). The
/// native Coordinator's isInsideCode, which AutoPairing's `isCode` and the
/// typing substitutions ask at the start of the range being replaced.
/// `fencedBlocks` spares a scan of the text when the caller has them.
export function isInsideCode(
  text: string,
  location: number,
  fencedBlocks: readonly TextRange[] = fencedBlockRanges(text),
): boolean {
  if (fencedBlocks.some((block) => locationInRange(location, block))) return true;
  const end = Math.min(location, text.length);
  let backticks = 0;
  for (let index = lineStart(text, end); index < end; index += 1) {
    if (text.charCodeAt(index) === 0x60) backticks += 1;
  }
  return backticks % 2 === 1;
}

/// Whether a line opens or closes a fence: up to three spaces or tabs, then
/// three or more backticks or tildes.
export function isFenceLine(line: string): boolean {
  return /^[ \t]{0,3}(?:`{3,}|~{3,})/.test(line);
}

/// A line as the fence pairing reads it: where it starts, where the next
/// one starts (past its break), and its text without the break.
export interface FenceLine {
  start: number;
  next: number;
  text: string;
}

/// The fenced code blocks, each from its opening line's start to past its
/// closing line's break. A single linear pass pairs fence lines as they come
/// (any fence closes any other), and an unclosed fence runs to `end`; that
/// spares the pathological backtracking a multiline pattern has on
/// documents with orphan fences. The native highlighter's fencedBlockRanges.
/// The lines come from whoever holds the text: a string here, the editor's
/// own document in the window.
export function pairFences(lines: Iterable<FenceLine>, end: number): TextRange[] {
  const ranges: TextRange[] = [];
  let openLocation: number | null = null;
  for (const line of lines) {
    if (!isFenceLine(line.text)) continue;
    if (openLocation === null) {
      openLocation = line.start;
    } else {
      ranges.push({ location: openLocation, length: line.next - openLocation });
      openLocation = null;
    }
  }
  if (openLocation !== null) ranges.push({ location: openLocation, length: end - openLocation });
  return ranges;
}

function* linesOf(text: string): Generator<FenceLine> {
  let start = 0;
  while (start < text.length) {
    const newline = text.indexOf("\n", start);
    const lineEnd = newline === -1 ? text.length : newline;
    const next = newline === -1 ? text.length : newline + 1;
    yield { start, next, text: text.slice(start, lineEnd) };
    start = next;
  }
}

/// The fenced code blocks of a text (pairFences over its lines).
export function fencedBlockRanges(text: string): TextRange[] {
  return pairFences(linesOf(text), text.length);
}
