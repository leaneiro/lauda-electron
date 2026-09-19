import { StateEffect, StateField, type EditorState } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import { SearchCursor } from "@codemirror/search";
import type { FindCounts } from "../find";

interface FindState {
  query: string;
  matches: { from: number; to: number }[];
  current: number;
}

const empty: FindState = { query: "", matches: [], current: -1 };
const setFind = StateEffect.define<FindState>();

/// Every case-insensitive match of `query`, as the native editor finds them.
function matchesOf(state: EditorState, query: string): { from: number; to: number }[] {
  if (!query) return [];
  const matches: { from: number; to: number }[] = [];
  const cursor = new SearchCursor(state.doc, query, 0, state.doc.length, (text) => text.toLowerCase());
  while (!cursor.next().done) matches.push({ from: cursor.value.from, to: cursor.value.to });
  return matches;
}

const current = Decoration.mark({ class: "cm-searchMatch-selected" });
const other = Decoration.mark({ class: "cm-searchMatch" });

function decorationsFor(find: FindState): DecorationSet {
  return Decoration.set(find.matches.map((m, i) => (i === find.current ? current : other).range(m.from, m.to)));
}

/// The matches and the current one, drawn as decorations so they never
/// touch the text or its undo. Edits shift the matches; they are found again
/// and the current one stays at its index.
export const findField = StateField.define<FindState>({
  create: () => empty,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setFind)) return effect.value;
    if (!transaction.docChanged || !value.query) return value;
    const matches = matchesOf(transaction.state, value.query);
    return { query: value.query, matches, current: matches.length ? Math.min(Math.max(value.current, 0), matches.length - 1) : -1 };
  },
  provide: (field) => EditorView.decorations.from(field, decorationsFor),
});

function counts(find: FindState): FindCounts {
  return { current: find.current + 1, total: find.matches.length };
}

/// Recomputes matches and jumps to the first one at or after the caret.
export function findUpdate(view: EditorView, query: string): FindCounts {
  const matches = matchesOf(view.state, query);
  const caret = view.state.selection.main.from;
  const index = matches.length ? Math.max(matches.findIndex((m) => m.from >= caret), 0) : -1;
  const find = { query, matches, current: index };
  view.dispatch({ effects: [setFind.of(find), ...scrollTo(find)] });
  return counts(find);
}

export function findStep(view: EditorView, forward: boolean): FindCounts {
  const state = view.state.field(findField);
  if (!state.matches.length) return { current: 0, total: 0 };
  const index = (state.current + (forward ? 1 : -1) + state.matches.length) % state.matches.length;
  const find = { ...state, current: index };
  view.dispatch({ effects: [setFind.of(find), ...scrollTo(find)] });
  return counts(find);
}

export function findClear(view: EditorView): void {
  view.dispatch({ effects: setFind.of(empty) });
}

export function findCounts(state: EditorState): FindCounts | null {
  const find = state.field(findField);
  return find.query ? counts(find) : null;
}

function scrollTo(find: FindState) {
  const match = find.matches[find.current];
  return match ? [EditorView.scrollIntoView(match.from, { y: "center" })] : [];
}
