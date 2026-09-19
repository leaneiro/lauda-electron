import { describe, expect, it } from "vitest";
import { saveStatus, saveStatusColor, saveStatusIcon, type SaveStatus } from "../../src/shared/document";

const file = "/tmp/notes.md";
const savedAt = new Date(1_800_000_000 * 1000);

describe("SaveStatus", () => {
  it("says a new document isn't saved yet", () => {
    const status = saveStatus({ text: "draft", fileURL: null, lastSavedText: null, lastSaveDate: null });
    expect(status).toEqual({ kind: "notSavedYet" });
  });

  /// The save notification can arrive before the window learns the file's URL.
  it("counts a first save before the file's location arrives", () => {
    const status = saveStatus({ text: "draft", fileURL: null, lastSavedText: "draft", lastSaveDate: savedAt });
    expect(status).toEqual({ kind: "saved", date: savedAt });
  });

  it("says a file opened from disk is saved, without a time", () => {
    const status = saveStatus({ text: "notes", fileURL: file, lastSavedText: "notes", lastSaveDate: null });
    expect(status).toEqual({ kind: "saved", date: null });
  });

  it("says text that differs from the last save is being edited", () => {
    const status = saveStatus({ text: "notes!", fileURL: file, lastSavedText: "notes", lastSaveDate: savedAt });
    expect(status).toEqual({ kind: "editing" });
  });

  /// With a URL but no save seen yet (not opened from disk), the text can't match anything.
  it("says a file without a known saved text is being edited", () => {
    const status = saveStatus({ text: "notes", fileURL: file, lastSavedText: null, lastSaveDate: null });
    expect(status).toEqual({ kind: "editing" });
  });

  /// The native labels ("Not saved yet", "Saved", "Saved · %@", "Editing…")
  /// are the caller's to word; each status carries what its label needs.
  it("has an icon and a color for each status", () => {
    const notSavedYet: SaveStatus = { kind: "notSavedYet" };
    const saved: SaveStatus = { kind: "saved", date: savedAt };
    const editing: SaveStatus = { kind: "editing" };
    expect(saveStatusIcon(notSavedYet)).toBe("circle.dotted");
    expect(saveStatusIcon(saved)).toBe("checkmark.circle.fill");
    expect(saveStatusIcon({ kind: "saved", date: null })).toBe("checkmark.circle.fill");
    expect(saveStatusIcon(editing)).toBe("ellipsis.circle.fill");
    expect(saveStatusColor(notSavedYet)).toBe("secondary");
    expect(saveStatusColor(saved)).toBe("green");
    expect(saveStatusColor(editing)).toBe("orange");
  });
});
