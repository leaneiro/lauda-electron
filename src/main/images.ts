import { constants, existsSync, realpathSync } from "node:fs";
import { copyFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { imageImport, isImageFile, pastedImageTimestamp, uniqueDestination } from "../shared/document";
import type { Strings } from "../shared/i18n";
import type { ImageImportResult } from "../shared/ipc";
import { messageOf } from "./dialogs";

// The decisions (whether an image is copied or referenced where it is, the
// name it takes, the name of a pasted one) are the tested rules in
// shared/document/imageImporter; this file does the copying and writing.

/// Whether `directory` already holds a file named `name`, asked of the file
/// system, which knows whether names differing in case collide there.
function takenIn(directory: string): (name: string) => boolean {
  return (name) => existsSync(join(directory, name));
}

/// A path in `directory` for a file named `name`, made unique with -2, -3…
export function freePathIn(directory: string, name: string): string {
  return join(directory, uniqueDestination(name, takenIn(directory)));
}

/// Copies an image into `directory`, unless it already lives inside it, and
/// returns the path to reference in Markdown, relative to `directory`. The
/// copy never goes over a file that appeared in the meantime.
async function importImage(source: string, directory: string): Promise<string> {
  const decision = imageImport(realpathSync(source), realpathSync(directory), takenIn(directory));
  if (decision.kind === "reference") return decision.path;
  await copyFile(source, join(directory, decision.name), constants.COPYFILE_EXCL);
  return decision.name;
}

/// Brings dropped or pasted image files into the document's folder.
export async function importImages(documentPath: string, files: string[]): Promise<ImageImportResult> {
  const directory = dirname(documentPath);
  const paths: string[] = [];
  let error: string | undefined;
  for (const file of files.filter(isImageFile)) {
    try {
      paths.push(await importImage(file, directory));
    } catch (failure) {
      error ??= messageOf(failure);
    }
  }
  return { paths, error };
}

/// Saves a pasted image (a screenshot) as PNG next to the document, named
/// with the time it was pasted, and never over an existing file.
export async function savePastedImage(
  documentPath: string,
  png: Uint8Array,
  strings: Strings,
  now = new Date(),
): Promise<ImageImportResult> {
  const directory = dirname(documentPath);
  const name = uniqueDestination(strings.t("image-%@.png", pastedImageTimestamp(now)), takenIn(directory));
  try {
    await writeFile(join(directory, name), png, { flag: "wx" });
    return { paths: [name] };
  } catch (failure) {
    return { paths: [], error: messageOf(failure) };
  }
}
