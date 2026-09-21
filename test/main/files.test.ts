import { lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { decodeText, retryingTransientErrors, writeAtomically } from "../../src/main/files";

const folders: string[] = [];
function folder(): string {
  const path = mkdtempSync(join(tmpdir(), "lauda-files-"));
  folders.push(path);
  return path;
}
afterEach(() => {
  for (const path of folders.splice(0)) rmSync(path, { recursive: true, force: true });
});

function failure(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

describe("writing a document", () => {
  it("replaces the text and keeps nothing else behind", async () => {
    const dir = folder();
    const file = join(dir, "notes.md");
    writeFileSync(file, "old");
    await writeAtomically(file, "new text");
    expect(readFileSync(file, "utf8")).toBe("new text");
  });

  it("writes through a symbolic link, which stays a link", async () => {
    const dir = folder();
    const real = join(dir, "real.md");
    const link = join(dir, "link.md");
    writeFileSync(real, "old");
    symlinkSync(real, link);

    await writeAtomically(link, "through the link");
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readFileSync(real, "utf8")).toBe("through the link");
  });

  /// An exported PDF goes through the same steps as a document's text.
  it("writes bytes as they are", async () => {
    const dir = folder();
    const file = join(dir, "export.pdf");
    writeFileSync(file, "old");
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x0a]);
    await writeAtomically(file, bytes);
    expect(new Uint8Array(readFileSync(file))).toEqual(bytes);
    expect(readdirSync(dir)).toEqual(["export.pdf"]);
  });

  it("creates a file that isn't there yet", async () => {
    const dir = folder();
    const file = join(dir, "new.md");
    await writeAtomically(file, "first words");
    expect(readFileSync(file, "utf8")).toBe("first words");
  });
});

describe("a file another program holds for a moment", () => {
  const noWait = async () => {};

  it("is tried again until it lets go", async () => {
    let attempts = 0;
    const result = await retryingTransientErrors(
      async () => {
        attempts += 1;
        if (attempts < 3) throw failure("EBUSY");
        return "done";
      },
      [1, 1, 1, 1],
      noWait,
    );
    expect(result).toBe("done");
    expect(attempts).toBe(3);
  });

  it("gives up once the tries run out", async () => {
    let attempts = 0;
    await expect(
      retryingTransientErrors(
        async () => {
          attempts += 1;
          throw failure("EPERM");
        },
        [1, 1],
        noWait,
      ),
    ).rejects.toThrow("EPERM");
    expect(attempts).toBe(3);
  });

  it("doesn't retry a failure that won't pass", async () => {
    let attempts = 0;
    await expect(
      retryingTransientErrors(
        async () => {
          attempts += 1;
          throw failure("ENOSPC");
        },
        [1, 1, 1],
        noWait,
      ),
    ).rejects.toThrow("ENOSPC");
    expect(attempts).toBe(1);
  });
});

describe("reading a document", () => {
  it("drops a byte order mark and falls back to Latin-1", () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toBe("a");
    expect(decodeText(new Uint8Array([0x63, 0x61, 0x66, 0xe9]))).toBe("café");
  });
});
