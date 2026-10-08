/// Which pane a published scroll position moves, with the panes scrolling
/// together (linked, which the chain on the divider sets) or apart
/// (ScrollSync.swift's movesEditor and movesPreview): never the pane that
/// published it, the other pane's only while linked, and a jump, like the
/// outline's, always.

export type ScrollSource = "editor" | "preview" | "navigation";

export function movesEditor(source: ScrollSource, linked: boolean): boolean {
  switch (source) {
    case "editor":
      return false;
    case "preview":
      return linked;
    case "navigation":
      return true;
  }
}

export function movesPreview(source: ScrollSource, linked: boolean): boolean {
  switch (source) {
    case "preview":
      return false;
    case "editor":
      return linked;
    case "navigation":
      return true;
  }
}
