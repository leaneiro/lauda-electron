import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { freePathIn, importImages, savePastedImage } from "../../src/main/images";
import { Strings } from "../../src/shared/i18n";

// The copying the tested rules in shared/document decide on, against a
// real folder.

const folders: string[] = [];
function folder(): string {
  const path = mkdtempSync(join(tmpdir(), "lauda-images-"));
  folders.push(path);
  return path;
}
afterEach(() => {
  for (const path of folders.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("images brought into a document's folder", () => {
  it("copies one from elsewhere, under a name of its own", async () => {
    const documents = folder();
    const elsewhere = folder();
    writeFileSync(join(documents, "photo.png"), "already here");
    writeFileSync(join(elsewhere, "photo.png"), "the new one");

    const result = await importImages(join(documents, "notes.md"), [join(elsewhere, "photo.png")]);
    expect(result).toEqual({ paths: ["photo-2.png"], error: undefined });
    expect(readFileSync(join(documents, "photo-2.png"), "utf8")).toBe("the new one");
    expect(readFileSync(join(documents, "photo.png"), "utf8")).toBe("already here");
  });

  it("references one already inside it, without copying", async () => {
    const documents = folder();
    mkdirSync(join(documents, "images"));
    writeFileSync(join(documents, "images", "diagram.svg"), "<svg/>");

    const result = await importImages(join(documents, "notes.md"), [join(documents, "images", "diagram.svg")]);
    expect(result.paths).toEqual(["images/diagram.svg"]);
    expect(readdirSync(documents).sort()).toEqual(["images"]);
  });

  it("leaves out what isn't an image", async () => {
    const documents = folder();
    const elsewhere = folder();
    writeFileSync(join(elsewhere, "notes.txt"), "text");
    const result = await importImages(join(documents, "doc.md"), [join(elsewhere, "notes.txt")]);
    expect(result.paths).toEqual([]);
    expect(readdirSync(documents)).toEqual([]);
  });

  it("names a pasted one by the time it was pasted, never over another", async () => {
    const documents = folder();
    const strings = new Strings("en", true);
    const when = new Date(2026, 8, 21, 14, 30, 5);
    writeFileSync(join(documents, "image-20260921-143005.png"), "taken");

    const result = await savePastedImage(join(documents, "doc.md"), new Uint8Array([1, 2, 3]), strings, when);
    expect(result.paths).toEqual(["image-20260921-143005-2.png"]);
    expect(readFileSync(join(documents, "image-20260921-143005.png"), "utf8")).toBe("taken");
  });

  it("finds a free path for a file moved into a folder", () => {
    const documents = folder();
    writeFileSync(join(documents, "notes.md"), "");
    expect(freePathIn(documents, "notes.md")).toBe(join(documents, "notes-2.md"));
    expect(freePathIn(documents, "other.md")).toBe(join(documents, "other.md"));
  });
});
