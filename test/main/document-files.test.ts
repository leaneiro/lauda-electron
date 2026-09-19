import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveDocumentFile } from "../../src/main/document-files";

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
