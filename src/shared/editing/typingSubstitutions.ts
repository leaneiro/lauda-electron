import { maxRange, type TextRange } from "./textEdit";

// Notion-style typing substitutions: `->` becomes `→` as you type, and `<-`
// becomes `←`.
//
// The native Coordinator asks before every change it's told of whose
// replacement is text (shouldChangeTextIn), which in practice means a typed
// character that AutoPairing left alone. It skips the question while an input
// method is composing and inside code (isInsideCode at the range's start),
// where `->` is usually meant literally. When a substitution comes back, it
// is typed in the change's place, through the same path as a typed character
// (so OpenPairs hears of it like any edit), and the change itself is dropped.

const pairs = [
  { prior: "-", typed: ">", result: "→" },
  { prior: "<", typed: "-", result: "←" },
] as const;

/// The wider range to replace and what replaces it.
export interface Substitution {
  range: TextRange;
  replacement: string;
}

/// If typing `replacement` into `affectedRange` completes a known pair,
/// returns the wider range to replace and the substituted string.
export function substitution(text: string, affectedRange: TextRange, replacement: string): Substitution | null {
  for (const pair of pairs) {
    if (replacement !== pair.typed) continue;
    const start = affectedRange.location - pair.prior.length;
    if (start < 0 || maxRange(affectedRange) > text.length) continue;
    if (text.slice(start, affectedRange.location) === pair.prior) {
      return {
        range: { location: start, length: pair.prior.length + affectedRange.length },
        replacement: pair.result,
      };
    }
  }
  return null;
}
