/// A stretch of text the way NSRange measures it: a start and a length in
/// UTF-16 code units. JavaScript strings count UTF-16 code units too, so
/// offsets carry over from the native editor unchanged.
export interface TextRange {
  location: number;
  length: number;
}

/// A text replacement and the selection after it, worked out without the
/// editor, so the rules can be tested on plain strings. An editor applies it
/// by replacing `range` with `replacement`, then selecting `selection`.
export interface TextEdit {
  range: TextRange;
  replacement: string;
  selection: TextRange;
}

/// Just past the range's last unit (NSMaxRange).
export function maxRange(range: TextRange): number {
  return range.location + range.length;
}

/// Whether `location` is one of the range's units (NSLocationInRange), which
/// an empty range never has.
export function locationInRange(location: number, range: TextRange): boolean {
  return location >= range.location && location < maxRange(range);
}

/// The text a range covers (NSString's substring(with:)).
export function substring(text: string, range: TextRange): string {
  return text.slice(range.location, maxRange(range));
}
