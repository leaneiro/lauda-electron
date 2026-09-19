import { copyFile, writeFile } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import type { Strings } from "../shared/i18n";
import type { ImageImportResult } from "../shared/ipc";
import { isImagePath } from "../shared/markdown";

/// Appends -2, -3… before the extension when the name is taken.
export function uniqueDestination(name: string, directory: string): string {
  const extension = extname(name);
  const base = extension ? name.slice(0, -extension.length) : name;
  let candidate = join(directory, name);
  let counter = 2;
  while (existsSync(candidate)) {
    candidate = join(directory, `${base}-${counter}${extension}`);
    counter += 1;
  }
  return candidate;
}

/// Copies an image into `directory` (unless it already lives inside it)
/// and returns the path to reference in Markdown, relative to `directory`.
async function importImage(source: string, directory: string): Promise<string> {
  const base = realpathSync(directory);
  const canonical = realpathSync(source);
  if (canonical.startsWith(base + sep)) {
    return relative(base, canonical).split(sep).join("/");
  }
  const destination = uniqueDestination(basename(source), directory);
  await copyFile(source, destination);
  return basename(destination);
}

/// Brings dropped or pasted image files into the document's folder.
export async function importImages(documentPath: string, files: string[]): Promise<ImageImportResult> {
  const directory = dirname(documentPath);
  const paths: string[] = [];
  let error: string | undefined;
  for (const file of files.filter(isImagePath)) {
    try {
      paths.push(await importImage(file, directory));
    } catch (failure) {
      error ??= failure instanceof Error ? failure.message : String(failure);
    }
  }
  return { paths, error };
}

/// Saves a pasted image (a screenshot) as PNG next to the document, named
/// with the time it was pasted.
export async function savePastedImage(documentPath: string, png: Uint8Array, strings: Strings, now = new Date()): Promise<ImageImportResult> {
  const pad = (n: number) => String(n).padStart(2, "0");
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const destination = uniqueDestination(strings.t("image-%@.png", timestamp), dirname(documentPath));
  try {
    await writeFile(destination, png);
    return { paths: [basename(destination)] };
  } catch (failure) {
    return { paths: [], error: failure instanceof Error ? failure.message : String(failure) };
  }
}
