import { standardKeymap } from "@codemirror/commands";
import { openSearchPanel, search, searchKeymap } from "@codemirror/search";
import { EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { drawSelection, EditorView, keymap } from "@codemirror/view";
import type { WindowContext } from "../context";
import type { LaudaDocument } from "../document";
import type { EditorFinding, FindCounts } from "../find";
import type { ScrollSync } from "../scroll-sync";
import { behaviors, programmaticEdit } from "./behaviors";
import { findClear, findCounts, findField, findStep, findUpdate } from "./find";
import { markdownHighlighting } from "./highlight";
import { editorPhrases } from "./phrases";
import * as rules from "./rules";
import { EditorScrolling } from "./scrolling";

/// The Markdown editor pane (MarkdownTextView.swift): plain text with light
/// highlighting, the native typing behaviors, and its place in the shared
/// scroll position.
export class Editor implements EditorFinding {
  private readonly view: EditorView;
  private readonly scrolling: EditorScrolling;
  private countsHandler: ((counts: FindCounts) => void) | null = null;
  /// Set while text from outside (a revert) is put in, so it isn't taken
  /// for the reader typing.
  private isReplacing = false;

  constructor(
    private readonly context: WindowContext,
    private readonly host: HTMLElement,
    private readonly document: LaudaDocument,
    callbacks: {
      publishScroll: (sync: ScrollSync) => void;
      sharedPosition: () => ScrollSync;
      scrollableChanged: (scrollable: boolean) => void;
    },
  ) {
    this.view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: document.text,
        extensions: [
          behaviors(context, document),
          keymap.of(standardKeymap),
          drawSelection(),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            spellcheck: "false",
            autocorrect: "off",
            autocapitalize: "off",
            "aria-multiline": "true",
          }),
          markdownHighlighting,
          findField,
          // The editor's own find-and-replace (Find and Replace…), as the
          // native editor shows its text view's bar.
          search({ top: true }),
          editorPhrases(context.t),
          keymap.of(searchKeymap.filter((binding) => binding.key === "Escape")),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !this.isReplacing) this.document.edit(update.state.doc.toString());
            if (update.docChanged && this.countsHandler) {
              const counts = findCounts(update.state);
              if (counts) this.countsHandler(counts);
            }
          }),
        ],
      }),
    });
    this.scrolling = new EditorScrolling(
      this.view,
      callbacks.sharedPosition,
      callbacks.publishScroll,
      callbacks.scrollableChanged,
    );
  }

  /// Whether this pane scrolls together with the preview, for what it keeps
  /// when its text reflows.
  setLinked(linked: boolean): void {
    this.scrolling.isLinked = linked;
  }

  focus(): boolean {
    this.view.focus();
    return true;
  }

  applyStyle(fontFamily: string, fontSize: number): void {
    this.host.style.setProperty("--editor-font", fontFamily);
    this.host.style.setProperty("--editor-size", `${fontSize}px`);
    this.view.requestMeasure();
    this.scrolling.anchor();
  }

  /// Back at the shared position: the pane came into view or changed size.
  restoreScroll(): void {
    this.scrolling.anchor();
  }

  applyRemoteScroll(sync: ScrollSync): void {
    this.scrolling.applyRemote(sync);
  }

  /// Puts the caret at the start of a source line (the outline's jump).
  placeCaret(line: number): void {
    const doc = this.view.state.doc;
    if (line < 0 || line >= doc.lines) return;
    this.view.dispatch({ selection: EditorSelection.cursor(doc.line(line + 1).from) });
    this.view.focus();
  }

  /// Text from outside the editor replaces all of it; the caret stays where
  /// it was as far as the new text allows.
  replaceText(text: string): void {
    const caret = Math.min(this.view.state.selection.main.head, text.length);
    this.isReplacing = true;
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: text },
      selection: EditorSelection.cursor(caret),
      annotations: Transaction.addToHistory.of(false),
    });
    this.isReplacing = false;
  }

  // MARK: - Formatting (⌘B / ⌘I / ⌘K)

  /// Toggles a marker around the selection; with nothing selected it
  /// applies to the word under the caret.
  toggleMarker(marker: string): void {
    this.togglePair(marker, marker);
  }

  togglePair(opening: string, closing: string): void {
    const state = this.view.state;
    const selection = state.selection.main;
    const word = selection.empty ? state.wordAt(selection.head) : null;
    const wordRange = word ? { from: word.from, to: word.to } : { from: selection.from, to: selection.to };
    const edit = rules.togglePair(
      opening,
      closing,
      state.doc.toString(),
      { from: selection.from, to: selection.to },
      wordRange,
    );
    programmaticEdit(this.view, edit);
    this.view.focus();
  }

  async insertLink(): Promise<void> {
    const clipboard = await this.context.lauda.invoke("app:read-clipboard");
    const state = this.view.state;
    const selection = state.selection.main;
    programmaticEdit(
      this.view,
      rules.linkEdit(state.doc.toString(), { from: selection.from, to: selection.to }, clipboard),
    );
    this.view.focus();
  }

  // MARK: - Find

  findUpdate(query: string): FindCounts {
    return findUpdate(this.view, query);
  }

  findStep(forward: boolean): FindCounts {
    return findStep(this.view, forward);
  }

  findClear(): void {
    findClear(this.view);
  }

  showReplace(): void {
    openSearchPanel(this.view);
  }

  setFindCountsHandler(handler: ((counts: FindCounts) => void) | null): void {
    this.countsHandler = handler;
  }

  destroy(): void {
    this.scrolling.destroy();
    this.view.destroy();
  }
}
