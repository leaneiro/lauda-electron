import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

// The stores keep their files in Electron's data folder; here it is a
// temporary one, and the system's recent documents list is a stand-in.
const userData = mkdtempSync(join(tmpdir(), "lauda-store-"));
const systemRecents: string[] = [];
vi.mock("electron", () => ({
  app: {
    getPath: () => userData,
    addRecentDocument: (path: string) => systemRecents.push(path),
    clearRecentDocuments: () => systemRecents.splice(0),
  },
}));
afterAll(() => rmSync(userData, { recursive: true, force: true }));

const { RecentFiles, SettingsStore, readSession, readWindowState, sessionFile, windowStateFile } = await import(
  "../../src/main/store"
);

describe("what the app keeps between launches", () => {
  it("reads back the window where it was", () => {
    windowStateFile.write({ x: 40, y: 60, width: 1100, height: 700, maximized: true });
    expect(readWindowState()).toEqual({ x: 40, y: 60, width: 1100, height: 700, maximized: true });
  });

  it("takes a window file it can't trust as no file at all", () => {
    writeFileSync(join(userData, "window-state.json"), '{"width":"wide","height":700}');
    expect(readWindowState()).toBeUndefined();
    writeFileSync(join(userData, "window-state.json"), "not json at all");
    expect(readWindowState()).toBeUndefined();
    writeFileSync(join(userData, "window-state.json"), '{"width":900,"height":600,"x":"left","maximized":"yes"}');
    expect(readWindowState()).toEqual({ x: undefined, y: undefined, width: 900, height: 600, maximized: false });
  });

  it("keeps only the session's paths that are paths", () => {
    sessionFile.write({ files: ["/notes/a.md", "/notes/b.md"], selected: "/notes/b.md" });
    expect(readSession()).toEqual({ files: ["/notes/a.md", "/notes/b.md"], selected: "/notes/b.md" });
    writeFileSync(join(userData, "session.json"), '{"files":["/notes/a.md",42,null],"selected":7}');
    expect(readSession()).toEqual({ files: ["/notes/a.md"], selected: null });
  });

  it("stores settings, sanitized, and tells who listens", () => {
    const settings = new SettingsStore();
    const heard: number[] = [];
    settings.onChange((value) => heard.push(value.previewFontSize));
    settings.update({ previewFontSize: 18 });
    expect(settings.value.previewFontSize).toBe(18);
    expect(heard).toEqual([18]);
    expect(JSON.parse(readFileSync(join(userData, "settings.json"), "utf8")).previewFontSize).toBe(18);
    // A new store reads what was written.
    expect(new SettingsStore().value.previewFontSize).toBe(18);
  });

  it("lists recent files most recent first, once each, ten at most", () => {
    const recents = new RecentFiles();
    recents.clear();
    for (let n = 1; n <= 12; n++) recents.note(`/notes/${n}.md`);
    recents.note("/notes/5.md");
    expect(recents.list[0]).toBe("/notes/5.md");
    expect(recents.list).toHaveLength(10);
    expect(recents.list.filter((path) => path === "/notes/5.md")).toHaveLength(1);
    recents.forget("/notes/5.md");
    expect(recents.list).not.toContain("/notes/5.md");
    // The system's own list hears of each file opened.
    expect(systemRecents).toContain("/notes/12.md");
  });
});
