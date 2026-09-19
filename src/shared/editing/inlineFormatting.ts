import { trimmingWhitespacesAndNewlines } from "./characters";
import { isLikelyURL } from "./links";
import { maxRange, substring, type TextEdit, type TextRange } from "./textEdit";

// ⌘B / ⌘I (markers) and ⌘K (links) as plain text rules. The native editor
// applies each edit in one go, as an undo step of its own, apart from the
// typing around it.

/// The marker ⌘B toggles.
export const boldMarker = "**";
/// The marker ⌘I toggles.
export const italicMarker = "*";

/// Toggles `marker` (e.g. "**") around the selection. With nothing selected
/// it applies to `wordRange`, the word under the caret, as a double click
/// would select it (the caller works it out; an empty range or whitespace
/// when the caret isn't in a word); outside a word it inserts an empty pair
/// with the caret inside.
export function toggle(marker: string, text: string, selection: TextRange, wordRange: TextRange): TextEdit {
  let range = selection;
  const markerLength = marker.length;

  if (range.length === 0) {
    const word = wordRange.length > 0 ? substring(text, wordRange) : "";
    if (trimmingWhitespacesAndNewlines(word) === "") {
      return {
        range,
        replacement: marker + marker,
        selection: { location: range.location + markerLength, length: 0 },
      };
    }
    range = wordRange;
  }

  const selected = substring(text, range);

  // Unwrap when the markers are inside the selection…
  if (selected.startsWith(marker) && selected.endsWith(marker) && selected.length >= markerLength * 2 + 1) {
    const inner = selected.slice(markerLength, selected.length - markerLength);
    return {
      range,
      replacement: inner,
      selection: { location: range.location, length: inner.length },
    };
  }
  // …or just outside it.
  const before = { location: range.location - markerLength, length: markerLength };
  const after = { location: maxRange(range), length: markerLength };
  if (
    before.location >= 0 &&
    maxRange(after) <= text.length &&
    substring(text, before) === marker &&
    substring(text, after) === marker
  ) {
    return {
      range: { location: before.location, length: range.length + markerLength * 2 },
      replacement: selected,
      selection: { location: before.location, length: range.length },
    };
  }
  // Otherwise wrap.
  return {
    range,
    replacement: marker + selected + marker,
    selection: { location: range.location + markerLength, length: range.length },
  };
}

/// ⌘K: `[selection](url)`, taking the URL from the clipboard when it holds
/// one. The caret lands where the next thing to type goes: between the
/// brackets when nothing was selected, else between the parentheses, or over
/// the URL when there is one.
export function link(text: string, selection: TextRange, clipboard: string | null): TextEdit {
  const selected = selection.length > 0 ? substring(text, selection) : "";
  const pasted = trimmingWhitespacesAndNewlines(clipboard ?? "");
  const url = isLikelyURL(pasted) ? pasted : "";

  let newSelection: TextRange;
  if (selected === "") {
    newSelection = { location: selection.location + 1, length: 0 };
  } else if (url === "") {
    newSelection = { location: selection.location + selected.length + 3, length: 0 };
  } else {
    newSelection = { location: selection.location + selected.length + 3, length: url.length };
  }
  return { range: selection, replacement: `[${selected}](${url})`, selection: newSelection };
}
