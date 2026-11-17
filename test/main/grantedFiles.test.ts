import { describe, expect, it } from "vitest";
import { GrantedFiles, isOpenableByPath } from "../../src/main/granted-files";

describe("GrantedFiles", () => {
  it("knows only the files it was handed", () => {
    const granted = new GrantedFiles();
    granted.grant("/Users/someone/notes/a.md");
    expect(granted.has("/Users/someone/notes/a.md")).toBe(true);
    expect(granted.has("/Users/someone/notes/b.md")).toBe(false);
    expect(granted.has("/etc/hosts")).toBe(false);
  });

  it("sees through a path written another way", () => {
    const granted = new GrantedFiles();
    granted.grant("/Users/someone/notes/a.md");
    expect(granted.has("/Users/someone/notes/../notes/./a.md")).toBe(true);
  });

  it("forgets a file that was renamed or moved away", () => {
    const granted = new GrantedFiles();
    granted.grant("/notes/old.md");
    granted.revoke("/notes/old.md");
    granted.grant("/notes/new.md");
    expect(granted.has("/notes/old.md")).toBe(false);
    expect(granted.has("/notes/new.md")).toBe(true);
  });

  it("tells a path its file left from one it never had", () => {
    const granted = new GrantedFiles();
    granted.grant("/notes/old.md");
    granted.revoke("/notes/old.md");
    expect(granted.wasLeft("/notes/old.md")).toBe(true);
    expect(granted.wasLeft("/notes/../notes/old.md")).toBe(true);
    expect(granted.wasLeft("/etc/hosts")).toBe(false);
    expect(granted.wasLeft(undefined)).toBe(false);
    // A file there again (saved as, opened) is the window's to write.
    granted.grant("/notes/old.md");
    expect(granted.wasLeft("/notes/old.md")).toBe(false);
  });

  it("refuses what isn't a path", () => {
    const granted = new GrantedFiles();
    expect(granted.has(undefined)).toBe(false);
    expect(granted.has("")).toBe(false);
    expect(granted.has(42)).toBe(false);
  });
});

describe("opening by path", () => {
  const extensions = ["md", "markdown", "txt"];

  it("takes Markdown and plain text", () => {
    expect(isOpenableByPath("/notes/a.md", extensions)).toBe(true);
    expect(isOpenableByPath("/notes/B.MARKDOWN", extensions)).toBe(true);
    expect(isOpenableByPath("/notes/c.txt", extensions)).toBe(true);
  });

  it("refuses any other kind of file", () => {
    expect(isOpenableByPath("/Users/someone/.ssh/id_ed25519", extensions)).toBe(false);
    expect(isOpenableByPath("/etc/hosts", extensions)).toBe(false);
    expect(isOpenableByPath("/notes/picture.png", extensions)).toBe(false);
    expect(isOpenableByPath("", extensions)).toBe(false);
    expect(isOpenableByPath(null, extensions)).toBe(false);
  });
});
