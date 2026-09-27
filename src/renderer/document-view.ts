import { boldMarker, italicMarker, strikethroughMarker, underlineTags } from "../shared/editing";
import type { MenuCommand } from "../shared/ipc";
import { clampSplit, isSmoothModeChange, modeChangeMs } from "../shared/layout";
import { cssEditorFontFamily, cssFontFamily, type Settings, type ViewMode } from "../shared/settings";
import type { WindowContext } from "./context";
import type { LaudaDocument } from "./document";
import { Editor } from "./editor/editor";
import { FindSession } from "./find";
import { FindBar } from "./find-bar";
import { PreviewPane } from "./preview/preview-pane";
import { farFromTheEnd, type ScrollSync } from "./scroll-sync";
import { StatusBar } from "./status-bar";
import type { Workspace } from "./workspace";

/// The menu commands the panes carry out: find, and the formatting the
/// editor applies.
export type PaneCommand = Extract<
  MenuCommand,
  {
    name:
      | "find"
      | "find-next"
      | "find-previous"
      | "find-replace"
      | "bold"
      | "italic"
      | "underline"
      | "strikethrough"
      | "link";
  }
>;

/// One document's part of the window: its editor and preview side by side,
/// the find bar over them and the status bar under them. Each open document
/// has its own, so what a pane holds (the scroll position, the caret, undo,
/// a search) stays with its document while another tab is in front.
export class DocumentView {
  readonly element = document.createElement("section");
  private readonly panes = document.createElement("div");
  private readonly editorPane = document.createElement("div");
  private readonly divider = document.createElement("div");
  private readonly previewPane = document.createElement("div");
  private readonly editor: Editor;
  private readonly preview: PreviewPane;
  private readonly find: FindSession;
  private readonly status: StatusBar;
  private mode: ViewMode;
  private awayTimer: number | undefined;
  private readonly resizeObserver: ResizeObserver;
  private readonly unsubscribe: () => void;

  constructor(
    context: WindowContext,
    readonly document: LaudaDocument,
    private readonly workspace: Workspace,
  ) {
    this.mode = workspace.viewMode;
    this.element.className = "document";
    this.element.hidden = true;
    this.panes.className = "panes";
    this.panes.dataset.mode = this.mode;
    this.editorPane.className = "pane editor-pane";
    this.divider.className = "pane divider";
    this.previewPane.className = "pane preview-pane";
    const handle = window.document.createElement("div");
    handle.className = "divider-handle";
    this.divider.append(handle);
    this.panes.append(this.editorPane, this.divider, this.previewPane);
    this.element.append(this.panes);

    this.editor = new Editor(context, this.editorPane, document, {
      publishScroll: (sync) => this.publishScroll(sync),
      sharedPosition: () => document.scrollSync,
    });
    this.preview = new PreviewPane(context, this.previewPane, document, {
      publishScroll: (sync) => this.publishScroll(sync),
    });
    this.find = new FindSession(this.editor, this.preview, () => this.mode);
    new FindBar(context, this.panes, this.find, this.editor, () => this.mode);
    this.status = new StatusBar(context, document);
    this.element.append(this.status.element);

    this.applySettings(workspace.settings, true);
    this.setViewMode(this.mode, false);
    this.watchDivider(handle);
    this.resizeObserver = new ResizeObserver(() => this.layOut());
    this.resizeObserver.observe(this.panes);
    this.unsubscribe = document.onChange(() => {
      this.preview.setMarkdown(document.text, workspace.settings.strictLineBreaks);
    });
    this.preview.setMarkdown(document.text, workspace.settings.strictLineBreaks);
  }

  setVisible(visible: boolean): void {
    const wasHidden = this.element.hidden;
    this.element.hidden = !visible;
    if (!visible) return;
    this.editor.restoreScroll();
    // A hidden frame loses its scroll, and back in view it scrolls from the
    // top, which the preview took for the reader's place: in preview only, a
    // tab came back at the top. It goes back to the place it kept instead.
    if (wasHidden) this.preview.realign();
  }

  /// Gives the keyboard to the pane that types or scrolls in this mode.
  focus(): void {
    if (this.mode === "previewOnly") this.preview.focus();
    else this.editor.focus();
  }

  // MARK: - Panes

  setViewMode(mode: ViewMode, animated: boolean): void {
    const previous = this.mode;
    this.mode = mode;
    const textBytes = new TextEncoder().encode(this.document.text).length;
    const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const animates = animated && !reduceMotion && previous !== mode && isSmoothModeChange(previous, mode, textBytes);
    this.panes.classList.toggle("no-animation", !animates);
    // Both panes are on screen while one slides in or out. The one left
    // outside stays drawn there, clipped, and takes no clicks or focus
    // (inert). It used to be hidden, and on Windows (a VM without a GPU)
    // the change from editor only to both panes came at once, with no
    // slide. Likely cause, not measured: hidden, the preview's page stops
    // drawing, and has to draw anew on its way back.
    this.editorPane.inert = false;
    this.previewPane.inert = false;
    this.panes.dataset.mode = mode;
    window.clearTimeout(this.awayTimer);
    const settle = () => {
      this.editorPane.inert = mode === "previewOnly";
      this.previewPane.inert = mode === "editorOnly";
      this.editor.restoreScroll();
      this.preview.realign();
    };
    // A frame's margin past the animation, so the panes have arrived.
    if (animates) this.awayTimer = window.setTimeout(settle, modeChangeMs + 20);
    else settle();
    this.preview.setContentWidth(this.workspace.previewWidth.rem);
    this.find.modeChanged();
  }

  setSplit(fraction: number): void {
    this.layOut(fraction);
  }

  private layOut(fraction = this.workspace.settings.splitFraction): void {
    const width = this.panes.clientWidth;
    if (width <= 0) return;
    this.panes.style.setProperty("--split", String(clampSplit(fraction, width)));
  }

  private watchDivider(handle: HTMLElement): void {
    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      this.panes.classList.add("no-animation");
      window.document.body.style.cursor = "col-resize";
      const move = (moveEvent: PointerEvent) => {
        const rect = this.panes.getBoundingClientRect();
        const fraction = clampSplit((moveEvent.clientX - rect.left) / rect.width, rect.width);
        this.workspace.setSplitFraction(fraction);
      };
      const up = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        window.document.body.style.cursor = "";
        this.workspace.storeSplitFraction();
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
    });
  }

  // MARK: - Scroll sync

  /// A pane the reader scrolled tells the other where to go; the one that
  /// sent it ignores its own position coming back.
  private publishScroll(sync: ScrollSync): void {
    this.document.scrollSync = sync;
    if (sync.source === "editor" || sync.source === "navigation") this.preview.syncScroll(sync);
    if (sync.source === "preview" || sync.source === "navigation") this.editor.applyRemoteScroll(sync);
  }

  /// The outline's jump: both panes go to the heading's line, and the
  /// caret follows when the editor is showing (OutlineJump).
  jumpToLine(line: number): void {
    const lineCount = Math.max(this.document.text.split("\n").length, 1);
    this.publishScroll({
      line,
      fraction: line / lineCount,
      endLine: null,
      toEndDistance: farFromTheEnd,
      source: "navigation",
    });
    if (this.mode !== "previewOnly") this.editor.placeCaret(line);
  }

  // MARK: - Settings and text

  applySettings(settings: Settings, initial = false): void {
    this.editor.applyStyle(cssEditorFontFamily(settings.editorFontName), settings.editorFontSize);
    this.preview.setStyle(
      cssFontFamily(settings.previewFontName),
      settings.previewFontSize,
      settings.previewLineHeight,
    );
    this.preview.setContentWidth(this.workspace.previewWidth.rem);
    if (!initial) this.preview.setMarkdown(this.document.text, settings.strictLineBreaks);
    this.layOut(settings.splitFraction);
  }

  /// Text from outside the editor: a revert or another program's change.
  replaceText(text: string, saved = false): void {
    this.editor.replaceText(text);
    this.document.replaceText(text, saved);
  }

  fileMoved(): void {
    this.preview.fileMoved();
  }

  perform(command: PaneCommand): void {
    switch (command.name) {
      case "find":
        this.find.open();
        return;
      case "find-next":
        this.find.step(true);
        return;
      case "find-previous":
        this.find.step(false);
        return;
      case "find-replace":
        this.find.replace();
        return;
      case "bold":
        if (this.mode !== "previewOnly") this.editor.toggleMarker(boldMarker);
        return;
      case "italic":
        if (this.mode !== "previewOnly") this.editor.toggleMarker(italicMarker);
        return;
      case "underline":
        if (this.mode !== "previewOnly") this.editor.togglePair(underlineTags[0], underlineTags[1]);
        return;
      case "strikethrough":
        if (this.mode !== "previewOnly") this.editor.toggleMarker(strikethroughMarker);
        return;
      case "link":
        if (this.mode !== "previewOnly") void this.editor.insertLink();
        return;
    }
  }

  destroy(): void {
    this.unsubscribe();
    this.resizeObserver.disconnect();
    this.editor.destroy();
    this.preview.destroy();
    this.status.destroy();
    this.element.remove();
  }
}
