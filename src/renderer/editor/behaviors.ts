import { Annotation, EditorSelection, type Extension, Transaction } from "@codemirror/state";
import { EditorView, keymap, ViewPlugin, type ViewUpdate, type KeyBinding } from "@codemirror/view";
import { history, historyKeymap, insertNewline, insertTab, isolateHistory, redo, redoSelection, undo, undoSelection } from "@codemirror/commands";
import { lauda } from "../api";
import type { LaudaDocument } from "../document";
import * as rules from "./rules";

/// A programmatic edit (formatting, a list's next item, images) is its own
/// undo step, apart from the typing around it.
export function programmaticEdit(view: EditorView, edit: rules.Edit, userEvent = "input.lauda"): void {
  view.dispatch({
    changes: { from: edit.from, to: edit.to, insert: edit.insert },
    selection: EditorSelection.range(edit.selection.from, edit.selection.to),
    annotations: [isolateHistory.of("full"), Transaction.userEvent.of(userEvent)],
    scrollIntoView: true,
  });
}

// MARK: - Undo

/// Word-level undo: typing would coalesce into one step per pause; breaking
/// at each whitespace makes ⌘Z step back word by word instead.
function startsNewWord(transaction: Transaction): boolean {
  let whitespace = false;
  transaction.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
    const text = inserted.toString();
    if (text.length === 1 && /\s/.test(text)) whitespace = true;
  });
  return whitespace;
}

/// Undo and redo, and the rest of the history's own bindings less the two
/// for undoing a selection: the native editor has no such command, and they
/// sit on ⌘U and ⇧⌘U, where they would swallow the Format menu's shortcut
/// before the menu ever sees it.
export const historyBindings: KeyBinding[] = [
  { key: "Mod-z", run: undo, preventDefault: true },
  { key: "Mod-Shift-z", run: redo, preventDefault: true },
  { key: "Mod-y", run: redo, preventDefault: true },
  ...historyKeymap.filter((binding) => binding.run !== undoSelection && binding.run !== redoSelection),
];

export const wordUndo: Extension = [
  history({ newGroupDelay: 60_000, joinToEvent: (transaction, isAdjacent) => isAdjacent && !startsNewWord(transaction) }),
  keymap.of(historyBindings),
];

// MARK: - Pairs

/// Where a pair the editor just typed opens, carried by its transaction.
const opensPair = Annotation.define<number>();

/// The pairs the editor typed that the caret is still inside of (OpenPairs),
/// kept in step with every transaction the way the native coordinator
/// keeps them: an edit moves them or ends them, a caret outside ends them,
/// undo ends them all, and a new pair joins after the others moved.
class PairTracker {
  pairs = new rules.OpenPairs();

  update(update: ViewUpdate): void {
    for (const transaction of update.transactions) {
      if (transaction.isUserEvent("undo") || transaction.isUserEvent("redo")) {
        this.pairs.removeAll();
        continue;
      }
      // Changes come in document order, each measured against the pairs as
      // the earlier ones left them: where it starts in the new text.
      transaction.changes.iterChanges((fromA, toA, fromB, toB) => {
        this.pairs.textWillChange({ location: fromB, length: toA - fromA }, toB - fromB);
      });
      if (transaction.selection || transaction.docChanged) {
        const main = transaction.state.selection.main;
        this.pairs.selectionDidChange({ location: main.from, length: main.to - main.from });
      }
      const opener = transaction.annotation(opensPair);
      if (opener !== undefined) this.pairs.opened(opener);
    }
  }
}

const pairTracker = ViewPlugin.fromClass(PairTracker);

function openPair(view: EditorView): rules.Pair | null {
  return view.plugin(pairTracker)?.pairs.innermost ?? null;
}

/// Typing: opening characters bring their closing ones, closing ones the
/// editor typed are stepped over, and `->` becomes an arrow outside code.
const typing = EditorView.inputHandler.of((view, from, to, text) => {
  if (view.composing || text.length === 0) return false;
  const doc = view.state.doc.toString();

  // Arrows and marker pairing stay out of code (```blocks``` or `inline`),
  // where `->` and `*` are meant literally.
  const pairing = rules.pairTyping(text, { from, to }, doc, openPair(view), () => rules.isInsideCode(doc, from));
  if (pairing) {
    const changes = pairing.from === pairing.to && pairing.insert === "" ? [] : [{ from: pairing.from, to: pairing.to, insert: pairing.insert }];
    view.dispatch({
      changes,
      selection: EditorSelection.range(pairing.selection.from, pairing.selection.to),
      annotations: [Transaction.userEvent.of("input.type"), ...(pairing.opensPairAt !== undefined ? [opensPair.of(pairing.opensPairAt)] : [])],
      scrollIntoView: true,
    });
    return true;
  }

  const arrow = rules.arrowSubstitution(doc, { from, to }, text);
  if (arrow && !rules.isInsideCode(doc, from)) {
    view.dispatch({
      changes: { from: arrow.from, to: arrow.to, insert: arrow.insert },
      selection: EditorSelection.cursor(arrow.from + arrow.insert.length),
      annotations: Transaction.userEvent.of("input.type"),
      scrollIntoView: true,
    });
    return true;
  }
  return false;
});

/// A key an input method composes first, like the backtick on a Brazilian
/// keyboard: it reaches the text before it is known, so the pair is made
/// once the composition ends, over the character it left (AutoPairing's
/// composing case, as the native editor handles a dead key).
const composedPairs = EditorView.domEventHandlers({
  compositionend(event, view) {
    const typed = event.data;
    if (!typed || [...typed].length !== 1) return false;
    requestAnimationFrame(() => {
      if (view.composing) return;
      const head = view.state.selection.main.head;
      const from = head - typed.length;
      if (from < 0 || view.state.sliceDoc(from, head) !== typed || !view.state.selection.main.empty) return;
      const doc = view.state.doc.toString();
      const pairing = rules.pairTyping(typed, { from, to: head }, doc, openPair(view), () => rules.isInsideCode(doc, from), true);
      if (!pairing) return;
      view.dispatch({
        changes: [{ from: pairing.from, to: pairing.to, insert: pairing.insert }],
        selection: EditorSelection.range(pairing.selection.from, pairing.selection.to),
        annotations: [Transaction.userEvent.of("input.type.compose"), ...(pairing.opensPairAt !== undefined ? [opensPair.of(pairing.opensPairAt)] : [])],
      });
    });
    return false;
  },
});

// MARK: - Keys

/// Return continues a list with the next item, or ends it on an empty one;
/// Tab and Shift-Tab indent a list item when the caret is in its marker
/// (the native handleNewline and handleIndent). Elsewhere Return is a plain
/// newline and Tab types a tab, as in a plain text view.
function listEdit(view: EditorView, make: (text: string, selection: rules.Range) => rules.Edit | null): boolean {
  const selection = view.state.selection.main;
  const edit = make(view.state.doc.toString(), { from: selection.from, to: selection.to });
  if (!edit) return false;
  programmaticEdit(view, edit);
  return true;
}

const newline = (view: EditorView) => listEdit(view, rules.newlineEdit) || insertNewline(view);
const indent = (view: EditorView) => listEdit(view, (text, selection) => rules.indentEdit(text, selection, false)) || insertTab(view);
// Shift-Tab outside a list does nothing, rather than leave the editor.
const outdent = (view: EditorView) => listEdit(view, (text, selection) => rules.indentEdit(text, selection, true)) || true;

/// Deleting into an empty pair the editor typed takes both characters.
function deleteBackward(view: EditorView): boolean {
  const selection = view.state.selection.main;
  const edit = rules.pairDeleteBackward({ from: selection.from, to: selection.to }, openPair(view));
  if (!edit) return false;
  view.dispatch({
    changes: { from: edit.from, to: edit.to, insert: "" },
    selection: EditorSelection.cursor(edit.selection.from),
    annotations: Transaction.userEvent.of("delete.backward"),
  });
  return true;
}

export const editorBindings: KeyBinding[] = [
  { key: "Enter", run: newline },
  { key: "Tab", run: indent },
  { key: "Shift-Tab", run: outdent },
  { key: "Backspace", run: deleteBackward },
];

const keys = keymap.of(editorBindings);

// MARK: - Paste and drop

async function pngBytes(file: File): Promise<Uint8Array | null> {
  if (file.type === "image/png") return new Uint8Array(await file.arrayBuffer());
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return null;
  }
}

/// Images are copied into the document's folder, so a document without
/// one asks to be saved first.
async function insertImages(view: EditorView, document: LaudaDocument, files: File[], at: number | null): Promise<void> {
  if (!document.filePath) {
    await lauda.invoke("images:ask-save-first");
    return;
  }
  const withPaths = files.map((file) => ({ file, path: lauda.pathForFile(file) }));
  const result = withPaths.every((item) => item.path)
    ? await lauda.invoke("images:import", document.filePath, withPaths.map((item) => item.path))
    : await (async () => {
        const png = await pngBytes(files[0]);
        return png ? lauda.invoke("images:save-pasted", document.filePath as string, png) : { paths: [], error: "" };
      })();
  if (result.paths.length > 0) {
    const selection = view.state.selection.main;
    programmaticEdit(view, rules.imageInsertion(result.paths, { from: at ?? selection.from, to: at ?? selection.to }));
  }
  if (result.error) {
    await lauda.invoke("doc:show-error", rules.imageErrorTitle(), result.error);
  }
}

function imageFiles(list: FileList | null | undefined): File[] {
  return Array.from(list ?? []).filter((file) => file.type.startsWith("image/") || rules.isImageName(file.name));
}

function pasteAndDrop(document: LaudaDocument): Extension {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const data = event.clipboardData;
      if (!data) return false;
      const images = imageFiles(data.files);
      // A file copied in a file manager arrives as the file plus its name as
      // text: the file wins. Raw image data only counts without any text,
      // so rich web content still pastes as text (pasteIntent).
      const paths = images.map((file) => lauda.pathForFile(file)).filter((path) => path !== "");
      const text = data.getData("text/plain");
      if (rules.pastesImages(paths, paths.length < images.length, text)) {
        event.preventDefault();
        void insertImages(view, document, images, null);
        return true;
      }
      // A URL pasted over a selection makes it a link.
      const selection = view.state.selection.main;
      const link = rules.linkPaste(view.state.doc.toString(), { from: selection.from, to: selection.to }, text);
      if (!link) return false;
      event.preventDefault();
      view.dispatch({
        changes: { from: link.from, to: link.to, insert: link.insert },
        selection: EditorSelection.range(link.selection.from, link.selection.to),
        annotations: Transaction.userEvent.of("input.paste"),
      });
      return true;
    },
    drop(event, view) {
      const images = imageFiles(event.dataTransfer?.files);
      if (images.length === 0) return false;
      event.preventDefault();
      const at = view.posAtCoords({ x: event.clientX, y: event.clientY });
      void insertImages(view, document, images, at);
      return true;
    },
    dragover(event) {
      if (imageFiles(event.dataTransfer?.files).length > 0 || event.dataTransfer?.types.includes("Files")) {
        event.preventDefault();
        return true;
      }
      return false;
    },
  });
}

export function behaviors(document: LaudaDocument): Extension {
  return [wordUndo, pairTracker, typing, composedPairs, keys, pasteAndDrop(document)];
}
