import { describe, expect, it } from "vitest";
import { recentMenuTitles } from "../../src/shared/document";

describe("Open Recent's titles", () => {
  it("shows only the name of files with names of their own", () => {
    expect(recentMenuTitles(["/a/notes/draft.md", "/a/notes/ideas.md"])).toEqual(["draft.md", "ideas.md"]);
  });

  it("shows the folder before the name of files that share it", () => {
    expect(recentMenuTitles(["/a/notes/draft.md", "/a/book/draft.md", "/a/book/ideas.md"])).toEqual([
      "…/notes/draft.md",
      "…/book/draft.md",
      "ideas.md",
    ]);
  });

  it("shows one folder more when the folders share a name too", () => {
    expect(recentMenuTitles(["/a/x/notes/draft.md", "/a/y/notes/draft.md"])).toEqual([
      "…/x/notes/draft.md",
      "…/y/notes/draft.md",
    ]);
  });

  it("writes a Windows path with its own separator", () => {
    expect(recentMenuTitles(["C:\\a\\notes\\draft.md", "C:\\a\\book\\draft.md"])).toEqual([
      "…\\notes\\draft.md",
      "…\\book\\draft.md",
    ]);
  });
});
