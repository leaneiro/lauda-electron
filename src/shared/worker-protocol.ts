import type { RenderedDocument } from "./markdown";

/// What the window asks its worker, which walks whole documents off the
/// window's thread, and what the worker answers. Each request carries an id
/// its answer comes back with.

/// From the window to the worker.
export type ToWorker =
  | { type: "render"; id: number; markdown: string; strictLineBreaks: boolean }
  | { type: "count"; id: number; text: string };

/// The counts the status bar shows.
export interface DocumentCounts {
  words: number;
  /// As the reader sees them: one per grapheme cluster.
  characters: number;
}

/// From the worker to the window. A failure names the error's kind only: a
/// parser's message can quote the document.
export type FromWorker =
  | ({ type: "rendered"; id: number } & RenderedDocument)
  | ({ type: "counted"; id: number } & DocumentCounts)
  | { type: "failed"; id: number; kind: string };
