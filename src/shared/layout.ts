import type { ViewMode } from "./settings";

/// Below this width a pane stops shrinking when the window does; the stored
/// split stays as it was, so a wider window brings it back (SplitDivider).
export const minPaneWidth = 280;

/// Between editor only and both panes the editor changes width, and its text
/// wraps anew on every frame; past some 50 KB that stutters, so the change
/// happens at once (ModeChange in EditorPanes.swift). The preview lays out
/// on its own and keeps up whatever the size, and a pane that only comes or
/// goes doesn't wrap again at all.
export const longestTextRewrappedSmoothly = 50_000;

export function isSmoothModeChange(from: ViewMode, to: ViewMode, textBytes: number): boolean {
  if (textBytes <= longestTextRewrappedSmoothly) return true;
  const pair = new Set([from, to]);
  return !(pair.size === 2 && pair.has("editorOnly") && pair.has("split"));
}

/// The divider's position shown for a stored fraction: clamped so both
/// panes keep a usable width.
export function clampSplit(fraction: number, totalWidth: number): number {
  if (totalWidth <= minPaneWidth * 2) return 0.5;
  const min = minPaneWidth / totalWidth;
  return Math.min(Math.max(fraction, min), 1 - min);
}

/// How long a change of layout takes, in milliseconds: the panes, the
/// toolbar's controls, the title and the tabs animate side by side, so they
/// share it. The stylesheet has the same figure as --mode-change (app.css),
/// and a change to one is a change to both (ModeChange.duration natively).
export const modeChangeMs = 200;
