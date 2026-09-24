import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, test } from "vitest";
import { pathWithExtension, resolveAppFile, resolveDocumentFile } from "../../src/main/document-files";

describe("what a document's preview may read", () => {
  let root: string;
  let folder: string;

  beforeAll(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "lauda-files-")));
    folder = join(root, "notes");
    mkdirSync(join(folder, "images"), { recursive: true });
    writeFileSync(join(folder, "pic.png"), "png");
    writeFileSync(join(folder, "images", "inside.jpg"), "jpg");
    writeFileSync(join(folder, "notes.md"), "# text");
    writeFileSync(join(root, "secret.png"), "outside");
    symlinkSync(join(root, "secret.png"), join(folder, "link.png"));
    writeFileSync(join(folder, "with space.gif"), "gif");
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test("images in the folder and below it", () => {
    expect(resolveDocumentFile(folder, "/pic.png")).toBe(join(folder, "pic.png"));
    expect(resolveDocumentFile(folder, "/images/inside.jpg")).toBe(join(folder, "images", "inside.jpg"));
    expect(resolveDocumentFile(folder, "/with%20space.gif")).toBe(join(folder, "with space.gif"));
  });

  test("nothing outside it, however it is asked for", () => {
    expect(resolveDocumentFile(folder, "/../secret.png")).toBeNull();
    expect(resolveDocumentFile(folder, "/%2e%2e/secret.png")).toBeNull();
    expect(resolveDocumentFile(folder, "/link.png")).toBeNull();
    expect(resolveDocumentFile(folder, join(root, "secret.png"))).toBeNull();
  });

  test("only images", () => {
    expect(resolveDocumentFile(folder, "/notes.md")).toBeNull();
    expect(resolveDocumentFile(folder, "/")).toBeNull();
    expect(resolveDocumentFile(folder, "/missing.png")).toBeNull();
    expect(resolveDocumentFile(folder, "/%E0%A4%A")).toBeNull();
  });
});

describe("the app's own scheme", () => {
  const dist = "/Applications/Lauda.app/Contents/Resources/app.asar/dist";

  it("serves the files inside the built app", () => {
    expect(resolveAppFile(dist, "/renderer/index.html")).toEqual({ file: `${dist}/renderer/index.html` });
    expect(resolveAppFile(dist, "/preview/preview.js")).toEqual({ file: `${dist}/preview/preview.js` });
  });

  it("refuses a path that climbs out, however it is spelled", () => {
    expect(resolveAppFile(dist, "/../../../../etc/passwd")).toEqual({ status: 403 });
    expect(resolveAppFile(dist, "/renderer/%2e%2e/%2e%2e/secrets")).toEqual({ status: 403 });
    expect(resolveAppFile(dist, "/..%2f..%2fetc%2fpasswd")).toEqual({ status: 403 });
  });

  it("refuses a path that doesn't decode", () => {
    expect(resolveAppFile(dist, "/renderer/%E0%A4%A.html")).toEqual({ status: 400 });
  });
});

/// Linux's save panel keeps a name typed without an extension as it is.
describe("a save panel's answer", () => {
  it("gets the type's extension when it has none", () => {
    expect(pathWithExtension("/home/a/notes", "md")).toBe("/home/a/notes.md");
    expect(pathWithExtension("/home/a/.hidden", "md")).toBe("/home/a/.hidden.md");
  });

  it("keeps an extension the reader typed", () => {
    expect(pathWithExtension("/home/a/notes.md", "md")).toBe("/home/a/notes.md");
    expect(pathWithExtension("/home/a/notes.txt", "md")).toBe("/home/a/notes.txt");
  });
});
