import type { EditorView } from "@codemirror/view";
import { differs, endConvergence, type ScrollSync } from "../scroll-sync";

/// Maps source lines to the editor's layout and back (SourceLineLayout.swift):
/// which line is at a scroll offset, and where to scroll to follow the
/// preview. A wrapped line is one block, all of its wrapped rows together.
export class SourceLineLayout {
  constructor(private readonly view: EditorView) {}

  /// Space above the first line, inside the scroller.
  private inset(): number {
    const scroller = this.view.scrollDOM;
    return this.view.documentTop - scroller.getBoundingClientRect().top + scroller.scrollTop;
  }

  /// Fractional source line at the top of the pane when scrolled to
  /// `offset`; [-1, 0) covers the padding above the first line.
  lineAtScrollOffset(offset: number): number {
    const inset = this.inset();
    const y = offset - inset;
    if (y < 0) return inset > 0 ? Math.max(y / inset, -1) : 0;
    const doc = this.view.state.doc;
    if (doc.length === 0) return 0;
    const block = this.view.lineBlockAtHeight(y);
    const line = doc.lineAt(block.from).number - 1;
    if (block.height <= 0) return line;
    return line + Math.min(Math.max((y - block.top) / block.height, 0), 1);
  }

  /// Scroll offset that puts `line` at the top of the visible area.
  scrollOffsetForLine(line: number): number | null {
    if (!Number.isFinite(line)) return null;
    const inset = this.inset();
    if (line < 0) return inset * (1 + Math.max(line, -1));
    const doc = this.view.state.doc;
    const index = Math.min(Math.floor(line), doc.lines - 1);
    const block = this.view.lineBlockAt(doc.line(index + 1).from);
    const within = Math.min(Math.max(line - index, 0), 1);
    return inset + block.top + within * block.height;
  }

  maxOffset(): number {
    const scroller = this.view.scrollDOM;
    return scroller.scrollHeight - scroller.clientHeight;
  }

  /// Where the editor should scroll to follow `sync`: the synced source line
  /// (proportional when there's no line map), absorbing over the leader's
  /// last few points the gap between where its final line lands here and
  /// this pane's end, so both reach the bottom together.
  targetOffset(sync: ScrollSync): number | null {
    const maxOffset = this.maxOffset();
    if (maxOffset <= 0) return null;
    const lineTarget = sync.line !== null ? this.scrollOffsetForLine(sync.line) : null;
    if (lineTarget === null) return Math.min(Math.max(sync.fraction * maxOffset, 0), maxOffset);
    let target = lineTarget;
    const endTarget = sync.endLine !== null ? this.scrollOffsetForLine(sync.endLine) : null;
    if (endTarget !== null) {
      const gap = Math.max(maxOffset - endTarget, 0);
      const stretch = Math.max(Math.min(endConvergence, this.view.scrollDOM.clientHeight), 1);
      target += gap * Math.max(0, 1 - sync.toEndDistance / stretch);
    }
    return Math.min(Math.max(target, 0), maxOffset);
  }
}

/// Keeps the editor pane in step with the position it shares with the
/// preview (EditorScrolling.swift): publishes where the reader scrolls,
/// follows the preview, and re-anchors when the pane changes size.
export class EditorScrolling {
  private readonly lines: SourceLineLayout;
  /// Where the editor put itself last; the scroll event that follows is
  /// that movement, not the reader's.
  private appliedTop: number | null = null;
  private lastSize = { width: 0, height: 0 };
  private readonly resizeObserver: ResizeObserver;
  /// Whether this pane scrolls together with the preview. Apart, it still
  /// publishes where it is, but keeps its own line when its text reflows,
  /// since the shared one may then be the preview's.
  isLinked = true;
  /// Where this pane is by its own account: what it last reported (shared
  /// or not), took from the preview or a jump, or was anchored to.
  private ownPosition: ScrollSync | null = null;
  /// Whether the text is taller than the pane, as last told; null before
  /// the pane is laid out.
  private scrollable: boolean | null = null;

  constructor(
    private readonly view: EditorView,
    private readonly sharedPosition: () => ScrollSync,
    private readonly publish: (sync: ScrollSync) => void,
    private readonly scrollableChanged: (scrollable: boolean) => void,
  ) {
    this.lines = new SourceLineLayout(view);
    view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });
    // The content grows and shrinks with its text: whether there is more
    // than fits changes with it, as with the pane's size.
    this.resizeObserver = new ResizeObserver(() => {
      this.sizeChanged();
      this.reportScrollable();
    });
    this.resizeObserver.observe(view.scrollDOM);
    this.resizeObserver.observe(view.contentDOM);
  }

  private readonly onScroll = () => {
    const scroller = this.view.scrollDOM;
    if (this.appliedTop !== null && Math.abs(scroller.scrollTop - this.appliedTop) < 1) return;
    this.appliedTop = null;
    if (scroller.clientHeight === 0) return;
    const maxOffset = this.lines.maxOffset();
    const offset = scroller.scrollTop;
    const sync: ScrollSync = {
      line: this.lines.lineAtScrollOffset(offset),
      fraction: maxOffset > 0 ? Math.min(Math.max(offset / maxOffset, 0), 1) : 0,
      endLine: this.lines.lineAtScrollOffset(Math.max(maxOffset, 0)),
      toEndDistance: Math.max(maxOffset - offset, 0),
      source: "editor",
    };
    this.ownPosition = sync;
    if (differs(sync, this.sharedPosition())) this.publish(sync);
  };

  /// Tells, when it changes, whether the text is taller than the pane by
  /// more than a hair.
  private reportScrollable(): void {
    const scrollable = this.lines.maxOffset() > 1;
    if (scrollable === this.scrollable) return;
    this.scrollable = scrollable;
    this.scrollableChanged(scrollable);
  }

  /// The pane changed size (the window, the divider, a mode change): its
  /// text wraps anew, so the same offset would show another line.
  private sizeChanged(): void {
    const { clientWidth: width, clientHeight: height } = this.view.scrollDOM;
    if (width === this.lastSize.width && height === this.lastSize.height) return;
    this.lastSize = { width, height };
    if (width > 0 && height > 0) this.anchor();
  }

  /// Positions the pane at the line it keeps: the shared position, or this
  /// pane's own while the panes scroll apart. A pane just created has no
  /// position of its own yet, and starts from the shared one.
  anchor(): void {
    const position = this.isLinked ? this.sharedPosition() : (this.ownPosition ?? this.sharedPosition());
    this.ownPosition = position;
    this.view.requestMeasure({
      read: () => this.lines.targetOffset(position),
      write: (target) => this.scrollTo(target),
    });
  }

  /// Scrolls to follow the preview. Heights far from the viewport are
  /// estimates until measured, so the position is checked again once the
  /// lines there have been laid out.
  applyRemote(sync: ScrollSync): void {
    this.ownPosition = sync;
    this.view.requestMeasure({
      read: () => this.lines.targetOffset(sync),
      write: (target) => {
        this.scrollTo(target);
        requestAnimationFrame(() => {
          const settled = this.lines.targetOffset(sync);
          if (settled !== null && Math.abs(settled - this.view.scrollDOM.scrollTop) > 1) this.scrollTo(settled);
        });
      },
    });
  }

  private scrollTo(target: number | null): void {
    if (target === null) return;
    const scroller = this.view.scrollDOM;
    const rounded = Math.round(target);
    if (Math.abs(rounded - scroller.scrollTop) <= 0.5) return;
    this.appliedTop = rounded;
    scroller.scrollTop = rounded;
  }

  destroy(): void {
    this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
    this.resizeObserver.disconnect();
  }
}
