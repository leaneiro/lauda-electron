// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LaudaDocument } from "../../src/renderer/document";
import type { WriteResult } from "../../src/shared/ipc";
import { fakeContext, type Handlers, type Request } from "./fakeContext";

/// What the text rests before it is written (document.ts).
const autosaveDelay = 2000;

function writes(requests: Request[]): unknown[][] {
  return requests.filter((request) => request.channel === "doc:write").map((request) => request.args);
}

/// A write that finishes when the test says, and that says when it started.
function heldWrite() {
  let finish: (result: WriteResult) => void = () => {};
  let hasStarted: () => void = () => {};
  const started = new Promise<void>((resolve) => (hasStarted = resolve));
  const handler = () =>
    new Promise<WriteResult>((resolve) => {
      finish = resolve;
      hasStarted();
    });
  return { handler, started, finish: (result: WriteResult) => finish(result) };
}

function fileDocument(handlers: Handlers = {}, text = "# Notes\n") {
  const { context, requests } = fakeContext({ "doc:write": () => ({ ok: true }), ...handlers });
  const document = new LaudaDocument(context, { filePath: "/docs/notes.md", text, title: "notes.md" });
  return { document, requests };
}

describe("LaudaDocument", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens with its file's text, saved", () => {
    const { document } = fileDocument();
    expect(document.text).toBe("# Notes\n");
    expect(document.savedText).toBe("# Notes\n");
    expect(document.isEdited).toBe(false);
    expect(document.title).toBe("notes.md");
    expect(document.folder).toBe("/docs");
  });

  /// Typing has to reach the file, or nothing would ever autosave.
  it("writes what was typed once the typing rests", async () => {
    const { document, requests } = fileDocument();
    document.edit("# Notes\n\nMore");
    expect(document.isEdited).toBe(true);
    await vi.advanceTimersByTimeAsync(autosaveDelay - 1);
    expect(writes(requests)).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(writes(requests)).toEqual([["/docs/notes.md", "# Notes\n\nMore"]]);
    expect(document.isEdited).toBe(false);
    expect(document.savedDate).not.toBeNull();
  });

  it("each keystroke puts the write off again", async () => {
    const { document, requests } = fileDocument();
    document.edit("a");
    await vi.advanceTimersByTimeAsync(autosaveDelay - 500);
    document.edit("ab");
    await vi.advanceTimersByTimeAsync(autosaveDelay - 500);
    expect(writes(requests)).toEqual([]);
    await vi.advanceTimersByTimeAsync(500);
    expect(writes(requests)).toEqual([["/docs/notes.md", "ab"]]);
  });

  /// An editor writes its text back even when nothing changed; that must
  /// not mark the document edited.
  it("the same text again changes nothing", async () => {
    const { document, requests } = fileDocument();
    const heard = vi.fn();
    document.onChange(heard);
    document.edit("# Notes\n");
    await vi.advanceTimersByTimeAsync(autosaveDelay);
    expect(heard).not.toHaveBeenCalled();
    expect(writes(requests)).toEqual([]);
  });

  /// The text is taken once per write: an edit that arrives while the file
  /// is being written is not recorded as saved.
  it("an edit made during a write stays edited", async () => {
    const write = heldWrite();
    const { document } = fileDocument({ "doc:write": write.handler });
    document.edit("first");
    const saving = document.autosave();
    document.edit("second");
    await write.started;
    write.finish({ ok: true });
    await saving;
    expect(document.savedText).toBe("first");
    expect(document.isEdited).toBe(true);
  });

  it("writes one text at a time, in order", async () => {
    const order: string[] = [];
    const firstWrite = heldWrite();
    const { document } = fileDocument({
      "doc:write": (_path, text) => {
        order.push(`start ${text}`);
        return text === "first" ? firstWrite.handler() : { ok: true };
      },
    });
    document.edit("first");
    const first = document.autosave();
    document.edit("second");
    const second = document.autosave();
    await firstWrite.started;
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(["start first"]);
    firstWrite.finish({ ok: true });
    await Promise.all([first, second]);
    expect(order).toEqual(["start first", "start second"]);
    expect(document.savedText).toBe("second");
  });

  it("a write that fails says so, and the document stays edited", async () => {
    const { document, requests } = fileDocument({ "doc:write": () => ({ ok: false, error: "EACCES" }) });
    document.edit("changed");
    expect(await document.autosave()).toBe(false);
    expect(requests.find((request) => request.channel === "doc:show-error")?.args).toEqual([
      "Couldn't save “notes.md”",
      "EACCES",
    ]);
    expect(document.isEdited).toBe(true);
  });

  it("a write that lands after the file moved marks nothing saved", async () => {
    const write = heldWrite();
    const { document } = fileDocument({ "doc:write": write.handler });
    document.edit("changed");
    const saving = document.autosave();
    await write.started;
    document.moved("/elsewhere/notes.md");
    write.finish({ ok: true });
    await saving;
    expect(document.savedText).toBe("# Notes\n");
  });

  /// While the reader chooses between their text and a file another app
  /// changed, nothing is written over the file.
  it("writes nothing while its writes are held", async () => {
    const { document, requests } = fileDocument();
    document.edit("mine");
    document.holdWrites();
    await vi.advanceTimersByTimeAsync(autosaveDelay);
    document.edit("mine, still");
    await vi.advanceTimersByTimeAsync(autosaveDelay);
    expect(await document.autosave()).toBe(false);
    expect(writes(requests)).toEqual([]);
    document.releaseWrites();
    expect(await document.autosave()).toBe(true);
    expect(writes(requests)).toEqual([["/docs/notes.md", "mine, still"]]);
  });

  it("an unchanged document has nothing to write", async () => {
    const { document, requests } = fileDocument();
    expect(await document.autosave()).toBe(true);
    expect(writes(requests)).toEqual([]);
  });

  it("Save writes at once, and is what Revert to Saved goes back to", async () => {
    const { document, requests } = fileDocument();
    document.edit("saved on purpose");
    expect(await document.save()).toBe(true);
    expect(writes(requests)).toEqual([["/docs/notes.md", "saved on purpose"]]);
    expect(document.revertText).toBe("saved on purpose");
  });

  /// The welcome guide opens with text and no file; opening and closing it
  /// asks nothing.
  it("a new document is edited once its text differs from what it was made with", () => {
    const { context } = fakeContext();
    const guide = new LaudaDocument(context, { filePath: null, text: "# Welcome", title: "Welcome" });
    expect(guide.isEdited).toBe(false);
    guide.edit("# Welcome!");
    expect(guide.isEdited).toBe(true);
    guide.edit("# Welcome");
    expect(guide.isEdited).toBe(false);
  });

  /// A duplicate is the reader's own change from the start, and stays one
  /// whatever its text becomes.
  it("a duplicate is edited from the start", () => {
    const { context } = fakeContext();
    const copy = new LaudaDocument(context, { filePath: null, text: "text", title: "notes copy", edited: true });
    expect(copy.isEdited).toBe(true);
    copy.edit("");
    expect(copy.isEdited).toBe(true);
  });

  it("a new document writes nothing until it has a file", async () => {
    const { context, requests } = fakeContext();
    const document = new LaudaDocument(context, { filePath: null, text: "", title: "Untitled" });
    document.edit("draft");
    await vi.advanceTimersByTimeAsync(autosaveDelay);
    expect(requests).toEqual([]);
  });

  it("Save on a new document asks where, and takes that file's name", async () => {
    const { context, requests } = fakeContext({ "doc:save-as": () => "/docs/draft.md" });
    const document = new LaudaDocument(context, { filePath: null, text: "draft", title: "Untitled" });
    expect(await document.save()).toBe(true);
    expect(requests[0]).toEqual({
      channel: "doc:save-as",
      args: [{ title: "Untitled", text: "draft", directory: null }],
    });
    expect(document.title).toBe("draft.md");
    expect(document.isEdited).toBe(false);
  });

  it("a Save As the reader cancels leaves the document as it was", async () => {
    const { context } = fakeContext({ "doc:save-as": () => null });
    const document = new LaudaDocument(context, { filePath: null, text: "draft", title: "Untitled" });
    expect(await document.save()).toBe(false);
    expect(document.filePath).toBeNull();
    expect(document.title).toBe("Untitled");
  });

  it("text from outside is saved only when it came from the file", () => {
    const { document } = fileDocument();
    document.replaceText("reverted", false);
    expect(document.isEdited).toBe(true);
    document.replaceText("from another program", true);
    expect(document.savedText).toBe("from another program");
    expect(document.isEdited).toBe(false);
  });

  it("names Windows paths too", () => {
    const { context } = fakeContext();
    const document = new LaudaDocument(context, { filePath: "C:\\docs\\notes.md", text: "", title: "" });
    expect(document.title).toBe("notes.md");
    expect(document.folder).toBe("C:\\docs");
  });
});
