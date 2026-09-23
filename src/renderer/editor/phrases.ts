import { EditorState, type Extension } from "@codemirror/state";
import type { TranslationKey } from "../../shared/i18n";
import type { WindowContext } from "../context";

/// The words CodeMirror shows or reads out itself, keyed as it names them,
/// with the catalog key that translates each: its find-and-replace panel
/// (Find and Replace…), what that panel tells a screen reader, and the
/// deleted selection it announces. The native editor has the system's own,
/// already in the reader's language.
export const editorPhraseKeys = {
  Find: "Find",
  Replace: "Replace",
  next: "Next",
  previous: "Previous",
  all: "All",
  "match case": "Match Case",
  regexp: "Regular Expression",
  "by word": "Whole Word",
  replace: "Replace",
  "replace all": "Replace All",
  close: "Close",
  "current match": "current match",
  "on line": "on line",
  "replaced $ matches": "replaced $ matches",
  "replaced match on line $": "replaced match on line $",
  "Selection deleted": "Selection deleted",
} as const satisfies Record<string, TranslationKey>;

/// CodeMirror's phrases in the reader's language.
export function editorPhrases(t: WindowContext["t"]): Extension {
  const phrases: Record<string, string> = {};
  for (const [phrase, key] of Object.entries(editorPhraseKeys)) phrases[phrase] = t(key);
  return EditorState.phrases.of(phrases);
}
