// The counts and the reading time the status bar shows under a document.
// The wording is the caller's, from the native keys "%lld words" and
// "%lld characters" (both with plural forms), "less than 1 min read" and
// "~%lld min read".
//
// Counting walks the whole text, which is slow for long Japanese or Chinese
// documents, so the native status bar counts words off the main thread: right
// away when a window opens, then after a 300 ms pause in typing, and it never
// shows a count that a newer edit superseded (WordCountModel).

const words = new Intl.Segmenter(undefined, { granularity: "word" });
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/// Words in `text`, by Unicode word boundaries, so languages written without
/// spaces between words (Japanese, Chinese) are counted by word too, and
/// Markdown markers (#, -, **) don't count as words.
///
/// The native app counts with the system's word boundaries. The two agree on
/// the whole, but macOS splits Japanese with a tokenizer of its own, so a
/// Japanese count can differ a little from the native one.
export function wordCount(text: string): number {
  return countWords(words.segment(text));
}

/// Characters that join the words on either side into one (Unicode's word
/// boundary rules WB6, WB7, WB11 and WB12): "example.com", "don't",
/// "3.14", "1,000". The system's segmenter keeps such words whole; the one
/// in Chromium's build of ICU splits some of them at the full stop, so the
/// pieces are joined again here to count as the native app does.
const joiners = new Set([
  ".",
  "'",
  "’",
  ":",
  "·",
  "\u2024",
  "\uFE52",
  "\uFF07",
  "\uFF0E",
  "\uFE13",
  "\uFE55",
  "\uFF1A",
  ",",
  ";",
]);
const numericJoiners = new Set([
  ",",
  ";",
  "\u037E",
  "\u0589",
  "\u060C",
  "\u060D",
  "\u066C",
  "\u07F8",
  "\u2044",
  "\uFE10",
  "\uFE14",
  "\uFF0C",
  "\uFF1B",
]);

function isLetterWord(segment: string): boolean {
  return /^\p{L}/u.test(segment);
}

function isNumberWord(segment: string): boolean {
  return /^\p{Nd}/u.test(segment);
}

/// Counts word-like segments, joining a word, a single joiner and a word
/// (letters around a full stop or apostrophe, digits around a full stop,
/// comma or semicolon) into one.
export function countWords(segments: Iterable<{ segment: string; isWordLike?: boolean }>): number {
  let count = 0;
  let previous: { segment: string; isWordLike?: boolean } | null = null;
  let joiner: string | null = null;
  for (const current of segments) {
    if (current.isWordLike) {
      const joined =
        previous !== null &&
        joiner !== null &&
        ((isLetterWord(previous.segment) &&
          isLetterWord(current.segment) &&
          joiners.has(joiner) &&
          !numericJoiners.has(joiner)) ||
          (isNumberWord(previous.segment) &&
            isNumberWord(current.segment) &&
            (joiner === "." || numericJoiners.has(joiner))));
      if (!joined) count += 1;
      previous = current;
      joiner = null;
    } else if (
      previous !== null &&
      joiner === null &&
      [...current.segment].length === 1 &&
      (joiners.has(current.segment) || numericJoiners.has(current.segment))
    ) {
      joiner = current.segment;
    } else {
      previous = null;
      joiner = null;
    }
  }
  return count;
}

/// Characters as a reader sees them (Swift's String.count), so an accented
/// letter or an emoji counts as one, whatever its UTF-16 length.
export function characterCount(text: string): number {
  let count = 0;
  for (const _ of graphemes.segment(text)) count += 1;
  return count;
}

/// The reading pace the estimate assumes.
export const wordsPerMinute = 200;

/// The estimated reading time: under a minute, or a whole number of minutes.
export type ReadingTime = { kind: "lessThanOneMinute" } | { kind: "minutes"; minutes: number };

/// Null for an empty document, which shows no reading time.
export function readingTime(wordCount: number): ReadingTime | null {
  if (wordCount <= 0) return null;
  // Halves round up, as Swift's rounded() does.
  const minutes = Math.round(wordCount / wordsPerMinute);
  return minutes < 1 ? { kind: "lessThanOneMinute" } : { kind: "minutes", minutes };
}
