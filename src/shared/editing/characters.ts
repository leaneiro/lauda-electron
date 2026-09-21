// Character classes drawn the way Foundation and Swift draw them, so the
// rules ported from the native editor decide alike. The tests below take one
// UTF-16 unit, and half of a surrogate pair (an emoji cut in two) passes
// none of them, as the native editor reads it as U+FFFD, which is neither a
// letter nor space.

/// Swift's Character.isWhitespace: the Unicode White_Space property, line
/// breaks included.
export function isWhitespace(character: string): boolean {
  return /^\p{White_Space}$/u.test(character);
}

/// Swift's `isLetter || isNumber`: alphabetic, CJK ideographs included, or
/// numeric, fractions and superscripts included.
export function isLetterOrNumber(character: string): boolean {
  return /^[\p{Alphabetic}\p{N}]$/u.test(character);
}

// Foundation's CharacterSet.whitespaces holds tabs, the space separators
// (Zs) and, by old habit, the zero width space; whitespacesAndNewlines adds
// the line breaks (U+000A to U+000D, U+0085, U+2028 and U+2029).
const whitespace = /^[\t\p{Zs}\u{200B}]$/u;
const whitespaceOrNewline = /^[\t-\r\p{Zs}\x85\u{200B}\u{2028}\u{2029}]$/u;

/// `text` trimmed of CharacterSet.whitespaces at both ends.
export function trimmingWhitespaces(text: string): string {
  return trimming(text, whitespace);
}

/// `text` trimmed of CharacterSet.whitespacesAndNewlines at both ends.
export function trimmingWhitespacesAndNewlines(text: string): string {
  return trimming(text, whitespaceOrNewline);
}

// Both sets lie in the Basic Multilingual Plane, so walking UTF-16 units
// finds every member, and a loop stays linear on long runs of spaces.
function trimming(text: string, set: RegExp): string {
  let start = 0;
  let end = text.length;
  while (start < end && set.test(text.charAt(start))) start += 1;
  while (end > start && set.test(text.charAt(end - 1))) end -= 1;
  return text.slice(start, end);
}
