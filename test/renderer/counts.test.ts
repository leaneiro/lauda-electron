// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CountsModel } from "../../src/renderer/counts";
import { characterCount, wordCount } from "../../src/shared/document";
import type { DocumentCounts } from "../../src/shared/worker-protocol";

/// A worker whose counts arrive when the test says.
class HeldCounter {
  readonly asked: string[] = [];
  private readonly answers: ((counts: DocumentCounts) => void)[] = [];

  readonly count = (text: string) => {
    this.asked.push(text);
    return new Promise<DocumentCounts | null>((resolve) => this.answers.push(resolve));
  };

  /// Answers the request made `index`th with the text's real counts.
  answer(index: number): void {
    const text = this.asked[index] ?? "";
    this.answers[index]?.({ words: wordCount(text), characters: characterCount(text) });
  }
}

/// The native WordCountModelTests, with the worker standing in for the
/// detached task.
describe("CountsModel", () => {
  let counter: HeldCounter;
  let model: CountsModel;

  beforeEach(() => {
    vi.useFakeTimers();
    counter = new HeldCounter();
    model = new CountsModel(counter.count, 300);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("the first count runs without waiting", async () => {
    model.update(() => "one two three");
    expect(counter.asked).toEqual(["one two three"]);
    counter.answer(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(model.counts?.words).toBe(3);
  });

  /// Characters are counted with the words, in the worker: both walk the
  /// whole text, and the status bar shows them side by side.
  it("counts characters as the reader sees them", async () => {
    model.update(() => "café \u{1F469}\u{200D}\u{1F469}\u{200D}\u{1F467} one");
    counter.answer(0);
    await vi.advanceTimersByTimeAsync(0);
    // The family emoji is three people joined into one: no word, so it
    // counts among the characters only, once, as the accented letter does.
    expect(model.counts).toEqual({ words: 2, characters: 10 });
  });

  it("later counts wait for a pause in typing, with the old count still up", async () => {
    model.update(() => "one");
    counter.answer(0);
    await vi.advanceTimersByTimeAsync(0);

    let text = "one two";
    model.update(() => text);
    await vi.advanceTimersByTimeAsync(299);
    expect(counter.asked).toEqual(["one"]);
    expect(model.counts?.words).toBe(1);
    // What is counted is the text as it is once the pause is over.
    text = "one two three";
    await vi.advanceTimersByTimeAsync(1);
    expect(counter.asked).toEqual(["one", "one two three"]);
    counter.answer(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(model.counts?.words).toBe(3);
  });

  it("a count superseded by a newer edit is never shown", async () => {
    model.update(() => "one");
    counter.answer(0);
    await vi.advanceTimersByTimeAsync(0);

    model.update(() => "one two three four");
    await vi.advanceTimersByTimeAsync(300);
    model.update(() => "one two");
    await vi.advanceTimersByTimeAsync(300);
    // The newer count comes back first, then the older one.
    counter.answer(2);
    counter.answer(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(model.counts?.words).toBe(2);
  });

  it("each keystroke puts the count off again", async () => {
    model.update(() => "one");
    counter.answer(0);
    await vi.advanceTimersByTimeAsync(0);
    for (const text of ["one t", "one tw", "one two"]) {
      model.update(() => text);
      await vi.advanceTimersByTimeAsync(200);
    }
    expect(counter.asked).toEqual(["one"]);
    await vi.advanceTimersByTimeAsync(100);
    expect(counter.asked).toEqual(["one", "one two"]);
  });

  it("a stopped model counts nothing more, and takes no late answer", async () => {
    model.update(() => "one");
    model.stop();
    counter.answer(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(model.counts).toBeNull();
  });
});
