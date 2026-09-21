import { isLetterOrNumber, isWhitespace } from "./characters";
import { locationInRange, maxRange, substring, type TextEdit, type TextRange } from "./textEdit";

// Typing an opening character types its closing one too, with the caret
// between them, and typed over a selection the pair wraps it. Brackets and
// double quotes pair everywhere; Markdown's markers only outside code, where
// they mean something.
//
// Only a pair the editor typed is the editor's to take back: typing its
// closing character steps over it, and deleting into it empty removes both
// (see OpenPairs). What the writer typed stays as typed.
//
// How an editor drives these rules. The native Coordinator and EditorTextView
// do it this way, and the CodeMirror integration must do the same, in the same
// order, or the pairs go stale and the editor steps over or deletes characters
// the writer typed:
//
// 1. Every change to the text, whatever makes it (typing, Delete, paste,
//    formatting commands, list continuation, the edits these rules return),
//    first calls `openPairs.textWillChange(range, replacementLength)`, with
//    the replaced range as it is before the change. For a change of several
//    ranges at once, such as a CodeMirror transaction, call it once per range
//    in document order, each placed where the earlier ones left it: from
//    iterChanges, the range {location: fromB, length: toA - fromA} and the
//    replacement length toB - fromB.
// 2. Undo and redo put back text from before the pairs were typed, and so
//    does replacing the whole text from outside (a file reloaded from disk):
//    those call `openPairs.removeAll()` instead.
// 3. Every selection change, the ones edits make included, then calls
//    `openPairs.selectionDidChange(selection)` with the new selection (the
//    main one; the native editor has only one).
// 4. A typed character (keys and input methods alike; never undo, paste or a
//    command) asks `typing` before it goes in, with the text as it is before
//    the keystroke:
//    - `range`: the range the input system says it replaces, else what an
//      input method is still composing, else the selection;
//    - `composing`: whether that range holds an input method's uncommitted
//      text (a dead key's accent), which the committed character replaces;
//    - `openPair`: `openPairs.innermost`;
//    - `isCode`: `isInsideCode(text, range.location)`, asked only when needed.
//    On null the character goes in as usual (TypingSubstitutions then has its
//    say). Otherwise the character itself is dropped and, in this order:
//    a. when the edit changes text (its range or its replacement isn't
//       empty), the edit is applied, as any change is (1);
//    b. the selection becomes `edit.selection` (3);
//    c. when `opensPairAt` isn't null, `openPairs.opened(opensPairAt)`: the
//       new pair's positions are in the edited text, so it opens last.
// 5. Delete (deleteBackward), unless an input method is composing, first asks
//    `deletingBackward(selection, openPairs.innermost)`. An edit that comes
//    back is applied (1) and its selection set (3) in place of the usual
//    deletion.

/// What a keystroke does instead of inserting its character.
export interface Typing {
  edit: TextEdit;
  /// Where a pair the editor just typed opens, for OpenPairs.
  opensPairAt: number | null;
}

/// A pair the editor typed: the UTF-16 offsets of its opening and closing
/// characters (OpenPairs.Pair).
export interface OpenPair {
  opener: number;
  closer: number;
}

/// Opening characters and the ones that close them.
const closers: ReadonlyMap<string, string> = new Map([
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
  ['"', '"'],
  ["*", "*"],
  ["_", "_"],
  ["`", "`"],
]);
/// Markdown's markers, plain characters inside code.
const markers: ReadonlySet<string> = new Set(["*", "_", "`"]);
/// Markers that say more doubled (`**` is bold), so a second one typed in an
/// empty pair of them opens a pair inside it.
const doubling: ReadonlySet<string> = new Set(["*", "_"]);
/// What a new pair may be typed right before. Before anything else, a word
/// most of all, the opening character is marking text by hand.
const roomyNeighbours: ReadonlySet<string> = new Set([")", "]", "}", ".", ",", ";", ":", "!", "?"]);

/// What typing `typed` in place of `range` does, when it isn't simply
/// inserting it. `composing` says `range` holds what an input method is still
/// composing (an accent's dead key), which the typed character replaces;
/// otherwise `range` is the selection.
export function typing(
  typed: string,
  range: TextRange,
  composing: boolean,
  text: string,
  openPair: OpenPair | null,
  isCode: () => boolean,
): Typing | null {
  // The native check is for one Character. Every character that pairs or
  // closes a pair is a single UTF-16 unit, so anything longer simply goes in.
  if (typed.length !== 1) return null;
  const character = typed;
  const isCaret = composing || range.length === 0;
  const start = range.location;
  const end = maxRange(range);
  const before = characterAt(text, start - 1);
  const after = characterAt(text, end);
  const reachesOpenPair = isCaret && openPair !== null && openPair.closer === end;
  const isInEmptyOpenPair = reachesOpenPair && openPair.opener === start - 1;
  const caretAfterOne = { location: start + 1, length: 0 };

  // The closing character of a pair the editor typed: step over it. An empty
  // `*` or `_` pair is the exception, the second marker making it `**` or `__`.
  if (reachesOpenPair && after === character) {
    if (isInEmptyOpenPair && doubling.has(character)) {
      return {
        edit: { range, replacement: typed + typed, selection: caretAfterOne },
        opensPairAt: start,
      };
    }
    return { edit: { range, replacement: "", selection: caretAfterOne }, opensPairAt: null };
  }
  // A space in an empty `*` or `_` pair: the star begins a list item or
  // stands alone, as in 2 * 3, and closes nothing.
  if (character === " " && isInEmptyOpenPair && before !== null && doubling.has(before)) {
    return {
      edit: {
        range: { location: start, length: end + 1 - start },
        replacement: " ",
        selection: caretAfterOne,
      },
      opensPairAt: null,
    };
  }

  const closer = closers.get(character);
  if (closer === undefined) return null;
  if (markers.has(character) && isCode()) return null;

  if (!isCaret) {
    return {
      edit: {
        range,
        replacement: character + substring(text, range) + closer,
        selection: { location: start + 1, length: range.length },
      },
      opensPairAt: null,
    };
  }
  const hasRoom = after === null || isWhitespace(after) || roomyNeighbours.has(after);
  if (!(hasRoom || reachesOpenPair) || before === "\\") return null;
  // A quote or a marker opens and closes with the same character: after a
  // letter, a digit or another one of it, the character closes.
  if (closer === character && before !== null && (isLetterOrNumber(before) || before === character)) {
    return null;
  }
  return {
    edit: { range, replacement: character + closer, selection: caretAfterOne },
    opensPairAt: start,
  };
}

/// Deleting the opening character of an empty pair the editor typed takes
/// the closing one with it.
export function deletingBackward(selection: TextRange, openPair: OpenPair | null): TextEdit | null {
  if (selection.length !== 0 || openPair === null) return null;
  if (openPair.opener !== selection.location - 1 || openPair.closer !== selection.location) return null;
  return {
    range: { location: openPair.opener, length: 2 },
    replacement: "",
    selection: { location: openPair.opener, length: 0 },
  };
}

/// The UTF-16 unit at `index`; null past either end of the text. Half of a
/// surrogate pair (an emoji) stays half, which, like the native U+FFFD, is
/// neither a word nor room for a pair.
function characterAt(text: string, index: number): string | null {
  return text[index] ?? null;
}

/// The pairs the editor typed that the caret hasn't left yet, innermost
/// last. They move with the edits around them, and an edit that takes either
/// of a pair's characters ends that pair.
///
/// Mutable state of one editor, as the Coordinator keeps it; it belongs with
/// the editor view (a CodeMirror view plugin, say), fed as described above.
export class OpenPairs {
  private stack: OpenPair[] = [];

  /// The open pairs, outermost first.
  get pairs(): readonly OpenPair[] {
    return this.stack;
  }

  /// The pair typing and Delete look at.
  get innermost(): OpenPair | null {
    return this.stack.at(-1) ?? null;
  }

  opened(location: number): void {
    this.stack.push({ opener: location, closer: location + 1 });
  }

  textWillChange(range: TextRange, replacementLength: number): void {
    const shift = replacementLength - range.length;
    const end = maxRange(range);
    this.stack = this.stack.flatMap((pair) => {
      if (locationInRange(pair.opener, range) || locationInRange(pair.closer, range)) return [];
      return [
        {
          opener: pair.opener >= end ? pair.opener + shift : pair.opener,
          closer: pair.closer >= end ? pair.closer + shift : pair.closer,
        },
      ];
    });
  }

  selectionDidChange(selection: TextRange): void {
    this.stack = this.stack.filter((pair) => !(selection.location <= pair.opener || maxRange(selection) > pair.closer));
  }

  removeAll(): void {
    this.stack = [];
  }
}
