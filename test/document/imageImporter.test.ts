import { describe, expect, it } from "vitest";
import {
  type ClipboardFlavors,
  imageImport,
  imageInsertion,
  imageMarkdown,
  isImageFile,
  pastedImageTimestamp,
  pasteIntent,
  uniqueDestination,
} from "../../src/shared/document";

/// A folder holding these names, as the file system would answer.
function holding(...names: string[]): (name: string) => boolean {
  const taken = new Set(names);
  return (name) => taken.has(name);
}

const everythingExists = () => true;

describe("ImageImporter", () => {
  it("tells image files by their extension", () => {
    expect(isImageFile("/x/photo.PNG")).toBe(true);
    expect(isImageFile("/x/a.jpeg")).toBe(true);
    expect(isImageFile("/x/notes.md")).toBe(false);
  });

  it("reads extensions the way the native app does", () => {
    expect(isImageFile("file:///x/my%20photo.webp")).toBe(true);
    expect(isImageFile("C:\\x\\photo.GIF")).toBe(true);
    expect(isImageFile("/x/folder.png/")).toBe(true);
    expect(isImageFile("/x/.png")).toBe(false);
    expect(isImageFile("/x/photo.png.md")).toBe(false);
  });

  it("copies an image from outside the document's folder under its own name", () => {
    expect(imageImport("/ext/photo.png", "/docs", holding())).toEqual({ kind: "copy", name: "photo.png" });
  });

  it("resolves a name collision", () => {
    expect(imageImport("/ext/photo.png", "/docs", holding("photo.png"))).toEqual({
      kind: "copy",
      name: "photo-2.png",
    });
  });

  it("references an image already inside the folder without copying it", () => {
    expect(imageImport("/docs/local.png", "/docs", holding("local.png"))).toEqual({
      kind: "reference",
      path: "local.png",
    });
    expect(imageImport("/docs/img/inner.png", "/docs", holding())).toEqual({
      kind: "reference",
      path: "img/inner.png",
    });
  });

  it("tells a folder from another whose name starts the same", () => {
    expect(imageImport("/docs-old/photo.png", "/docs", holding())).toEqual({ kind: "copy", name: "photo.png" });
  });

  it("takes Windows paths and a trailing separator", () => {
    expect(imageImport("C:\\docs\\img\\a.png", "C:\\docs\\", holding())).toEqual({
      kind: "reference",
      path: "img/a.png",
    });
    expect(imageImport("D:\\ext\\a.png", "C:\\docs", holding())).toEqual({ kind: "copy", name: "a.png" });
  });

  it("numbers a taken name before its extension", () => {
    expect(uniqueDestination("photo.png", holding("photo.png", "photo-2.png"))).toBe("photo-3.png");
    expect(uniqueDestination("notes", holding("notes"))).toBe("notes-2");
    expect(uniqueDestination("archive.tar.gz", holding("archive.tar.gz"))).toBe("archive.tar-2.gz");
    expect(uniqueDestination(".hidden", holding(".hidden"))).toBe(".hidden-2");
    expect(uniqueDestination("free.png", holding("other.png"))).toBe("free.png");
  });

  /// saveImageData's name, without writing the PNG.
  it("names a pasted image by the time it was pasted", () => {
    const now = new Date(2026, 8, 19, 7, 5, 3);
    const timestamp = pastedImageTimestamp(now);
    expect(timestamp).toBe("20260919-070503");

    const name = "image-%@.png".replace("%@", timestamp);
    expect(name.startsWith("image-")).toBe(true);
    expect(name.endsWith(".png")).toBe(true);
    expect(uniqueDestination(name, holding(name))).toBe("image-20260919-070503-2.png");
  });

  it("encodes spaces in the Markdown", () => {
    expect(imageMarkdown(["my photo.png"])).toBe("![](my%20photo.png)");
    expect(imageMarkdown(["a.png", "b.png"])).toBe("![](a.png)\n\n![](b.png)");
  });

  it("encodes paths as Foundation does", () => {
    expect(imageMarkdown(["img/foto ção.png"])).toBe("![](img/foto%20%C3%A7%C3%A3o.png)");
    expect(imageMarkdown(["100%#1?.png"])).toBe("![](100%25%231%3F.png)");
    expect(imageMarkdown(["a;b(1)&c=d@e!.png"])).toBe("![](a;b(1)&c=d@e!.png)");
    expect(imageMarkdown(["a:b.png", "img/a:b.png"])).toBe("![](a%3Ab.png)\n\n![](img/a:b.png)");
    expect(imageMarkdown(["😀[1].png"])).toBe("![](%F0%9F%98%80%5B1%5D.png)");
  });

  /// The Coordinator's insertImageMarkdown, after the image was copied.
  it("inserts the Markdown at the caret, leaving the caret after it", () => {
    const text = "before ";
    const edit = imageInsertion(["chart.png"], { location: 7, length: 0 });
    const result = text.slice(0, edit.range.location) + edit.replacement + text.slice(edit.range.location);
    expect(result).toBe("before ![](chart.png)");
    expect(edit.selection).toEqual({ location: 21, length: 0 });
  });
});

describe("pasteIntent", () => {
  const clipboard = (flavors: Partial<ClipboardFlavors>): ClipboardFlavors => ({
    files: [],
    hasText: false,
    hasImageData: false,
    ...flavors,
  });

  /// A real Finder ⌘C: file URL + file name as text + icon TIFF.
  it("treats a Finder copy as an image file despite its text and icon", () => {
    const finderCopy = clipboard({ files: ["/docs/photo.png"], hasText: true, hasImageData: true });
    expect(pasteIntent(finderCopy, everythingExists)).toEqual({ kind: "imageFiles", files: ["/docs/photo.png"] });
  });

  it("treats screenshot data as an image", () => {
    expect(pasteIntent(clipboard({ hasImageData: true }), everythingExists)).toEqual({ kind: "imageData" });
  });

  /// Text that looks like a path to an image is text too: only files on the
  /// clipboard count.
  it("doesn't take plain text for an image", () => {
    expect(pasteIntent(clipboard({ hasText: true }), everythingExists)).toEqual({ kind: "notAnImage" });
  });

  it("keeps rich content with text and an image as text", () => {
    const web = clipboard({ hasText: true, hasImageData: true });
    expect(pasteIntent(web, everythingExists)).toEqual({ kind: "notAnImage" });
  });

  it("doesn't take a file that isn't an image for one", () => {
    expect(pasteIntent(clipboard({ files: ["/docs/notes.md"] }), everythingExists)).toEqual({ kind: "notAnImage" });
  });

  it("leaves out image files that are gone", () => {
    const flavors = clipboard({ files: ["/docs/gone.png", "/docs/here.png"], hasText: true });
    expect(pasteIntent(flavors, (path) => path === "/docs/here.png")).toEqual({
      kind: "imageFiles",
      files: ["/docs/here.png"],
    });
    expect(pasteIntent(clipboard({ files: ["/docs/gone.png"], hasText: true }), () => false)).toEqual({
      kind: "notAnImage",
    });
  });
});
