/// What the window and the preview page say to each other through the
/// frame's postMessage. Both sides import these, so what one sends is what
/// the other reads, as with the channels to the main process (ipc.ts).

/// Where the other pane is, in the preview's terms: `line` and `endLine` are
/// source lines, null when the leader can't name one and the fraction is all
/// there is to go on.
export interface PreviewPosition {
  line: number | null;
  endLine: number | null;
  fraction: number;
  /// Pixels the leader has left to scroll before its bottom.
  toEndDistance: number;
  /// Over how many of the leader's last pixels the page closes the gap
  /// between where the leader's last line lands in it and its own end.
  convergence: number;
}

/// From the window to the page.
export type ToPreview =
  | { type: "setContent"; id: number; html: string; lines: number[]; lineCount: number }
  | { type: "setStyle"; family: string; size: number; lineHeight: number }
  | { type: "setContentWidth"; rem: number }
  | { type: "setScrollPosition"; position: PreviewPosition }
  | { type: "realign" }
  | { type: "find"; id: number; query: string; forward: boolean; restart: boolean }
  | { type: "findClear" }
  | { type: "focus" };

/// From the page to the window.
export type FromPreview =
  | { type: "ready" }
  | { type: "contentApplied"; id: number }
  | { type: "findResult"; id: number; current: number; total: number }
  | { type: "previewScrolled"; line: number | null; endLine: number | null; fraction: number; toEndDistance: number }
  /// Whether the page has more than fits in it, told when that changes.
  | { type: "previewScrollable"; scrollable: boolean }
  | { type: "openLink"; href: string };

/// The messages the window waits on, and the reply each one gets, which
/// carries the message's id back.
export interface PreviewReplies {
  setContent: Extract<FromPreview, { type: "contentApplied" }>;
  find: Extract<FromPreview, { type: "findResult" }>;
}
