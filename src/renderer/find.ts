import type { ViewMode } from "../shared/settings";

export interface FindCounts {
  current: number;
  total: number;
}

/// What a search needs from the editor pane.
export interface EditorFinding {
  findUpdate(query: string): FindCounts;
  findStep(forward: boolean): FindCounts;
  findClear(): void;
  showReplace(): void;
  /// Receives new counts later, when edits change the matches.
  setFindCountsHandler(handler: ((counts: FindCounts) => void) | null): void;
}

/// What a search needs from the preview pane.
export interface PreviewFinding {
  find(query: string, forward: boolean, restart: boolean): Promise<FindCounts>;
  clearFind(): void;
}

/// A document's search: its query, the match counts and which pane answers
/// (FindSession.swift). The editor searches whenever it's visible; in
/// preview-only mode the preview does. The bar that shows it is FindBar.
export class FindSession {
  isPresented = false;
  query = "";
  current = 0;
  total = 0;
  private readonly listeners = new Set<() => void>();
  private readonly openListeners = new Set<() => void>();

  constructor(
    private readonly editor: EditorFinding,
    private readonly preview: PreviewFinding,
    private readonly mode: () => ViewMode,
  ) {}

  /// Anything the bar shows changed.
  onChange(listener: () => void): void {
    this.listeners.add(listener);
  }

  /// The bar was asked for, even when it was already showing: it takes the
  /// keyboard.
  onOpen(listener: () => void): void {
    this.openListeners.add(listener);
  }

  /// Shows the bar, searching again for a query that's already typed.
  open(): void {
    this.isPresented = true;
    this.editor.setFindCountsHandler((counts) => this.show(counts));
    for (const listener of this.openListeners) listener();
    if (this.query) this.search();
    else this.notifyChanged();
  }

  /// Searches for the query from the top of the document.
  search(): void {
    if (!this.isPresented) return;
    if (!this.query) {
      this.show({ current: 0, total: 0 });
      this.editor.findClear();
      this.preview.clearFind();
      return;
    }
    if (this.mode() === "previewOnly") this.findInPreview(true, true);
    else this.show(this.editor.findUpdate(this.query));
  }

  /// The next or previous match; opens the bar when there's nothing to step through.
  step(forward: boolean): void {
    if (!this.isPresented || !this.query) {
      this.open();
      return;
    }
    if (this.mode() === "previewOnly") this.findInPreview(forward, false);
    else this.show(this.editor.findStep(forward));
  }

  /// The editor's own find-and-replace. The preview can't replace, so in
  /// preview-only mode this opens the find bar instead.
  replace(): void {
    if (this.mode() === "previewOnly") {
      this.open();
    } else {
      this.close();
      this.editor.showReplace();
    }
  }

  close(): void {
    this.isPresented = false;
    this.editor.setFindCountsHandler(null);
    this.show({ current: 0, total: 0 });
    this.editor.findClear();
    this.preview.clearFind();
  }

  /// The panes change with the mode, so an open search starts over in them.
  modeChanged(): void {
    if (!this.isPresented) return;
    this.editor.findClear();
    this.preview.clearFind();
    queueMicrotask(() => this.search());
  }

  /// The preview answers later; an answer that arrives after the bar closed
  /// counts for nothing.
  private findInPreview(forward: boolean, restart: boolean): void {
    void this.preview.find(this.query, forward, restart).then((counts) => {
      if (this.isPresented) this.show(counts);
    });
  }

  private show(counts: FindCounts): void {
    this.current = counts.current;
    this.total = counts.total;
    this.notifyChanged();
  }

  private notifyChanged(): void {
    for (const listener of this.listeners) listener();
  }
}
