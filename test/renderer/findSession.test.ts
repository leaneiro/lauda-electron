import { beforeEach, describe, expect, it } from "vitest";
import { type EditorFinding, type FindCounts, FindSession, type PreviewFinding } from "../../src/renderer/find";
import type { ViewMode } from "../../src/shared/settings";

class FakeEditor implements EditorFinding {
  counts: FindCounts = { current: 0, total: 0 };
  readonly calls: string[] = [];
  countsHandler: ((counts: FindCounts) => void) | null = null;

  findUpdate(query: string): FindCounts {
    this.calls.push(`update ${query}`);
    return this.counts;
  }

  findStep(forward: boolean): FindCounts {
    this.calls.push(forward ? "next" : "previous");
    return this.counts;
  }

  findClear(): void {
    this.calls.push("clear");
  }

  showReplace(): void {
    this.calls.push("replace bar");
  }

  setFindCountsHandler(handler: ((counts: FindCounts) => void) | null): void {
    this.countsHandler = handler;
  }
}

class FakePreview implements PreviewFinding {
  counts: FindCounts = { current: 0, total: 0 };
  readonly calls: string[] = [];

  async find(query: string, forward: boolean, restart: boolean): Promise<FindCounts> {
    this.calls.push(`find ${query} ${forward ? "next" : "previous"}${restart ? " from top" : ""}`);
    return this.counts;
  }

  clearFind(): void {
    this.calls.push("clear");
  }
}

/// Lets the preview's answers, and anything else already queued, arrive.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/// The native FindSessionTests, one for one.
describe("FindSession", () => {
  let editor: FakeEditor;
  let preview: FakePreview;
  let mode: ViewMode;
  let session: FindSession;

  beforeEach(() => {
    editor = new FakeEditor();
    preview = new FakePreview();
    mode = "split";
    session = new FindSession(editor, preview, () => mode);
  });

  it.each<ViewMode>(["editorOnly", "split"])("with the editor visible (%s), the editor searches", (visible) => {
    mode = visible;
    editor.counts = { current: 1, total: 3 };
    session.open();
    session.query = "cat";
    session.search();
    expect(editor.calls).toEqual(["update cat"]);
    expect(preview.calls).toEqual([]);
    expect([session.current, session.total]).toEqual([1, 3]);
  });

  it("in preview-only mode the preview searches", async () => {
    mode = "previewOnly";
    preview.counts = { current: 2, total: 4 };
    session.open();
    session.query = "cat";
    session.search();
    await settle();
    expect(preview.calls).toEqual(["find cat next from top"]);
    expect(editor.calls).toEqual([]);
    expect([session.current, session.total]).toEqual([2, 4]);
  });

  it("clearing the query resets the counts and the highlights", () => {
    editor.counts = { current: 1, total: 3 };
    session.open();
    session.query = "cat";
    session.search();
    session.query = "";
    session.search();
    expect([session.current, session.total]).toEqual([0, 0]);
    expect(editor.calls).toEqual(["update cat", "clear"]);
    expect(preview.calls).toEqual(["clear"]);
  });

  it("searches nothing while the bar is closed", () => {
    session.query = "cat";
    session.search();
    expect(editor.calls).toEqual([]);
    expect(preview.calls).toEqual([]);
  });

  it("opening searches again for a query already typed", () => {
    session.query = "cat";
    session.open();
    expect(session.isPresented).toBe(true);
    expect(editor.calls).toEqual(["update cat"]);
  });

  it("stepping with nothing to step through opens the bar", () => {
    session.step(true);
    expect(session.isPresented).toBe(true);
    expect(editor.calls).toEqual([]);
  });

  it("steps go through the visible pane", async () => {
    session.open();
    session.query = "cat";
    session.step(true);
    session.step(false);
    expect(editor.calls).toEqual(["next", "previous"]);

    mode = "previewOnly";
    session.step(true);
    session.step(false);
    await settle();
    expect(preview.calls).toEqual(["find cat next", "find cat previous"]);
  });

  it("replace closes the bar for the editor's replace interface", () => {
    session.open();
    session.replace();
    expect(session.isPresented).toBe(false);
    expect(editor.calls).toEqual(["clear", "replace bar"]);
    expect(preview.calls).toEqual(["clear"]);
  });

  it("replace in preview-only mode opens the find bar", () => {
    mode = "previewOnly";
    session.replace();
    expect(session.isPresented).toBe(true);
    expect(editor.calls).toEqual([]);
  });

  it("closing resets everything", () => {
    editor.counts = { current: 1, total: 3 };
    session.open();
    session.query = "cat";
    session.search();
    session.close();
    expect(session.isPresented).toBe(false);
    expect([session.current, session.total]).toEqual([0, 0]);
    expect(editor.calls.at(-1)).toBe("clear");
    expect(preview.calls).toEqual(["clear"]);
  });

  /// Typing in the editor changes the matches; the editor reports new counts later.
  it("counts the editor reports later reach the bar", () => {
    session.open();
    editor.countsHandler?.({ current: 4, total: 9 });
    expect([session.current, session.total]).toEqual([4, 9]);
  });

  it("switching modes restarts an open search in the new pane", async () => {
    session.open();
    session.query = "cat";
    session.search();
    mode = "previewOnly";
    session.modeChanged();
    expect(editor.calls).toEqual(["update cat", "clear"]);
    expect(preview.calls).toEqual(["clear"]);
    await settle();
    expect(preview.calls).toEqual(["clear", "find cat next from top"]);
  });

  it("switching modes with the bar closed does nothing", async () => {
    mode = "previewOnly";
    session.modeChanged();
    await settle();
    expect(editor.calls).toEqual([]);
    expect(preview.calls).toEqual([]);
  });

  // What this edition adds.

  it("an answer from the preview that arrives after the bar closed changes nothing", async () => {
    mode = "previewOnly";
    preview.counts = { current: 1, total: 5 };
    session.open();
    session.query = "cat";
    session.search();
    session.close();
    await settle();
    expect([session.current, session.total]).toEqual([0, 0]);
  });

  it("the bar hears of every opening, so it can take the keyboard each time", () => {
    let openings = 0;
    session.onOpen(() => openings++);
    session.open();
    session.open();
    session.step(true);
    expect(openings).toBe(3);
  });

  it("closing stops the editor's later counts from reaching the bar", () => {
    session.open();
    session.close();
    expect(editor.countsHandler).toBeNull();
  });
});
