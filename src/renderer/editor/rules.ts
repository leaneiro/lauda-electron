import * as editing from "../../shared/editing";
import * as documents from "../../shared/document";
import { t } from "../api";

/// The native editing rules (src/shared/editing, ported from Swift with
/// NSRange-like {location, length} ranges), in the {from, to} terms
/// CodeMirror speaks.

export interface Range {
  from: number;
  to: number;
}

export interface Edit {
  from: number;
  to: number;
  insert: string;
  selection: Range;
}

export type Pair = editing.OpenPair;
export const OpenPairs = editing.OpenPairs;

const toTextRange = (range: Range): editing.TextRange => ({ location: range.from, length: range.to - range.from });
const toRange = (range: editing.TextRange): Range => ({ from: range.location, to: range.location + range.length });

function fromTextEdit(edit: editing.TextEdit): Edit {
  return { ...toRange(edit.range), insert: edit.replacement, selection: toRange(edit.selection) };
}

/// What typing a character does to pairs (AutoPairing): nil when it is
/// simply inserted.
export function pairTyping(
  typed: string,
  range: Range,
  text: string,
  openPair: Pair | null,
  isCode: () => boolean,
  composing = false,
): (Edit & { opensPairAt?: number }) | null {
  const result = editing.typing(typed, toTextRange(range), composing, text, openPair, isCode);
  if (!result) return null;
  return { ...fromTextEdit(result.edit), opensPairAt: result.opensPairAt ?? undefined };
}

export function pairDeleteBackward(selection: Range, openPair: Pair | null): Edit | null {
  const edit = editing.deletingBackward(toTextRange(selection), openPair);
  return edit ? fromTextEdit(edit) : null;
}

/// `->` becomes → and `<-` becomes ← as the second character is typed.
export function arrowSubstitution(text: string, range: Range, typed: string): { from: number; to: number; insert: string } | null {
  const result = editing.substitution(text, toTextRange(range), typed);
  return result ? { ...toRange(result.range), insert: result.replacement } : null;
}

export function isInsideCode(text: string, location: number): boolean {
  return editing.isInsideCode(text, location);
}

export function newlineEdit(text: string, selection: Range): Edit | null {
  const edit = editing.newlineEdit(text, toTextRange(selection));
  return edit ? fromTextEdit(edit) : null;
}

export function indentEdit(text: string, selection: Range, outdent: boolean): Edit | null {
  const edit = editing.indentEdit(text, toTextRange(selection), outdent);
  return edit ? fromTextEdit(edit) : null;
}

export const isLikelyURL = editing.isLikelyURL;

/// A URL pasted over a one-line selection that isn't one itself.
export function linkPaste(text: string, selection: Range, clipboard: string | null): Edit | null {
  const edit = editing.smartLinkPaste(text, toTextRange(selection), clipboard);
  return edit ? fromTextEdit(edit) : null;
}

/// ⌘B and ⌘I: the marker around the selection, or the word under the caret.
export function toggleMarker(marker: string, text: string, selection: Range, wordRange: Range): Edit {
  return togglePair(marker, marker, text, selection, wordRange);
}

export function togglePair(opening: string, closing: string, text: string, selection: Range, wordRange: Range): Edit {
  return fromTextEdit(editing.togglePair(opening, closing, text, toTextRange(selection), toTextRange(wordRange)));
}

/// ⌘K: `[selection](url)`, the URL taken from the clipboard when it holds one.
export function linkEdit(text: string, selection: Range, clipboard: string | null): Edit {
  return fromTextEdit(editing.link(text, toTextRange(selection), clipboard));
}

/// The images' Markdown in place of `range`, the caret after it.
export function imageInsertion(paths: readonly string[], range: Range): Edit {
  return fromTextEdit(documents.imageInsertion(paths, toTextRange(range)));
}

export function isImageName(name: string): boolean {
  return documents.isImageFile(name);
}

/// What a paste of these files and this text is (pasteIntent). A dropped or
/// pasted file with a path is on the disk: the system handed it over.
export function pastesImages(imagePaths: readonly string[], hasRawImages: boolean, text: string): boolean {
  const intent = documents.pasteIntent(
    { files: imagePaths, hasText: text !== "", hasImageData: hasRawImages },
    () => true,
  );
  return intent.kind !== "notAnImage";
}

export function imageErrorTitle(): string {
  return t("Couldn't add the image to the document's folder");
}
