import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const root = join(__dirname, "..");

function* sourceFiles(directory: string): Generator<string> {
  for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(path);
    else if (/\.(ts|mts|mjs|js|css|html)$/.test(entry.name)) yield path;
  }
}

/// A character that doesn't show (a byte order mark, a zero width space, a
/// NUL) changes what the code does without showing in a diff, and an editor
/// or formatter that normalizes the file removes it without a word. The code
/// writes them as escapes (\uFEFF, \0) instead. Tabs and line ends are the
/// only exceptions. The translations are text, and French puts no-break
/// spaces before its colons, so resources/ is left out.
it("no source file holds a character that doesn't show", () => {
  const invisible = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\u00A0\u2000-\u200A\u202F\u205F\u3000]/u;
  const found: string[] = [];
  for (const directory of ["src", "test", "e2e", "scripts"]) {
    for (const file of sourceFiles(directory)) {
      readFileSync(join(root, file), "utf8")
        .split("\n")
        .forEach((line, index) => {
          const match = line.replace(/[\t\r]/g, "").match(invisible);
          if (match?.[0]) {
            found.push(
              `${file}:${index + 1} U+${match[0].codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0")}`,
            );
          }
        });
    }
  }
  expect(found).toEqual([]);
});
