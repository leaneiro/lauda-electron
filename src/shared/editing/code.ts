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

// A line that opens or closes a fence: up to three spaces or tabs, then three
// or more backticks or tildes. Sticky, so each line is tested where it starts.
const fenceLine = /[ \t]{0,3}(?:`{3,}|~{3,})/y;

/// The fenced code blocks, each from its opening line's start to past its
/// closing line's break. A single linear pass pairs fence lines as they come
/// (any fence closes any other), and an unclosed fence runs to the end of the
/// text; that spares the pathological backtracking a multiline pattern has on
/// documents with orphan fences. The native highlighter's fencedBlockRanges.
export function fencedBlockRanges(text: string): TextRange[] {
  const ranges: TextRange[] = [];
  let openLocation: number | null = null;
  let location = 0;
  while (location < text.length) {
    const newline = text.indexOf("\n", location);
    const lineEnd = newline === -1 ? text.length : newline + 1;
    fenceLine.lastIndex = location;
    if (fenceLine.test(text)) {
      if (openLocation === null) {
        openLocation = location;
      } else {
        ranges.push({ location: openLocation, length: lineEnd - openLocation });
        openLocation = null;
      }
    }
    location = lineEnd;
  }
  if (openLocation !== null) {
    ranges.push({ location: openLocation, length: text.length - openLocation });
  }
  return ranges;
}
