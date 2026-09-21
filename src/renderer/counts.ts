import type { DocumentCounts } from "../shared/worker-protocol";

/// Keeps a document's word and character counts current
/// (WordCountModel.swift). Counting walks the whole text, so it runs in the
/// window's worker and, while typing, waits for a pause first. The counts
/// when the document opens come at once, and counts that a newer edit
/// superseded are never shown.
export class CountsModel {
  counts: DocumentCounts | null = null;
  private timer: number | undefined;
  /// The latest count asked for; an answer to an earlier one comes too late.
  private latest = 0;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly count: (text: string) => Promise<DocumentCounts | null>,
    private readonly pause = 300,
  ) {}

  onChange(listener: () => void): void {
    this.listeners.add(listener);
  }

  /// The text changed. `read` gives it as it is when the count runs, which
  /// after a pause is the latest.
  update(read: () => string): void {
    window.clearTimeout(this.timer);
    if (this.counts === null) this.run(read());
    else this.timer = window.setTimeout(() => this.run(read()), this.pause);
  }

  /// No count runs, or arrives, after this.
  stop(): void {
    window.clearTimeout(this.timer);
    this.latest += 1;
  }

  private run(text: string): void {
    const request = ++this.latest;
    void this.count(text).then((counts) => {
      if (!counts || request !== this.latest) return;
      this.counts = counts;
      for (const listener of this.listeners) listener();
    });
  }
}
