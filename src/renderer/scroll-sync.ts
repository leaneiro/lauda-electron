/// Shared scroll position between the panes, anchored in the source text so
/// both show the same block even when images or tables make the preview much
/// taller than the text (ScrollSync.swift). `source` marks which pane the
/// reader scrolled, so the other follows and echoes are ignored.
export interface ScrollSync {
  /// Fractional source line at the top of the pane; [-1, 0) is the padding
  /// above the first line. null when the pane has no line map.
  line: number | null;
  /// Proportional position, the fallback when there's no line map.
  fraction: number;
  /// Source line at the top of this pane when scrolled all the way down.
  endLine: number | null;
  /// Pixels left to scroll before the bottom; the follower uses it to land
  /// on the bottom together with the leader.
  toEndDistance: number;
  source: "editor" | "preview" | "navigation";
}

/// How much of the leader's final scrolling the follower spends closing
/// the gap between where the leader's last line lands in it and its own
/// end, in pixels: about two lines, as in the native app.
export const endConvergence = 60;

export function differs(a: ScrollSync, b: ScrollSync): boolean {
  return (
    Math.abs(a.fraction - b.fraction) > 0.001 ||
    Math.abs(a.toEndDistance - b.toEndDistance) > 1 ||
    Math.abs((a.line ?? -2) - (b.line ?? -2)) > 0.005
  );
}
