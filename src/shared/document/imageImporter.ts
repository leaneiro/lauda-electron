import type { TextEdit, TextRange } from "../editing/textEdit";
import { isImagePath } from "../markdown/content-policy";

// Images dropped or pasted into a document are brought into its folder, so
// they can be referenced with relative Markdown paths, which the preview and
// the exports resolve. Reading the clipboard, copying files and writing PNGs
// stay with the caller; these are the decisions in between.
//
// A paste asks pasteIntent first, then smartLinkPaste, then pastes as usual.
// Paths may use "/" or, on Windows, "\" between folders.

/// The extensions the app treats as images, and the test by extension, are
/// the content policy's: one list for what is imported and what the preview
/// is served (ContentPolicy.swift has the native one).
export { imageFileExtensions } from "../markdown/content-policy";

/// Whether a path, file URL or file name has an image's extension, in any case.
export function isImageFile(path: string): boolean {
  return isImagePath(path);
}

/// The clipboard's flavors that decide what a paste is, as the caller read them.
export interface ClipboardFlavors {
  /// Files on the clipboard, as paths or file URLs.
  files: readonly string[];
  /// Whether it holds plain text.
  hasText: boolean;
  /// Whether it holds raw image data (PNG or TIFF), such as a screenshot.
  hasImageData: boolean;
}

/// What a paste should insert: image files to import, the clipboard's image
/// data to save as a PNG, or whatever else it holds, pasted as usual.
export type PasteIntent = { kind: "imageFiles"; files: string[] } | { kind: "imageData" } | { kind: "notAnImage" };

/// Copying a file in the Finder puts the file URL plus the file name as text
/// plus the icon as TIFF, so image files that still exist win over both text
/// and raw data. Raw image data only counts when there's no text, which keeps
/// pasting rich web content (text and images) behaving as text.
export function pasteIntent(clipboard: ClipboardFlavors, fileExists: (path: string) => boolean): PasteIntent {
  const imageFiles = clipboard.files.filter((file) => isImageFile(file) && fileExists(file));
  if (imageFiles.length > 0) return { kind: "imageFiles", files: imageFiles };
  if (!clipboard.hasText && clipboard.hasImageData) return { kind: "imageData" };
  return { kind: "notAnImage" };
}

/// How an image joins a document: referenced where it is, by its path
/// relative to the document's folder, when it already lives inside it; else
/// copied in under `name` (the caller copies it, never over an existing file)
/// and referenced by that name.
export type ImageImport = { kind: "reference"; path: string } | { kind: "copy"; name: string };

/// ImageImporter.importImage without the copying. `source` and `directory`
/// must be canonical, symbolic links resolved, as fs.realpath gives them.
/// `isTaken` says whether the folder already holds a file of that name; ask
/// the file system, which knows whether names that differ in case collide.
export function imageImport(source: string, directory: string, isTaken: (name: string) => boolean): ImageImport {
  // Without its trailing separator, unless the folder is the root.
  const base = withSlashes(directory).replace(/(.)\/+$/, "$1");
  const file = withSlashes(source);
  if (file.startsWith(`${base}/`)) {
    return { kind: "reference", path: file.slice(base.length + 1) };
  }
  return { kind: "copy", name: uniqueDestination(lastPathComponent(source), isTaken) };
}

/// `name`, or, when it's taken, the name with -2, -3… appended before the
/// extension.
export function uniqueDestination(name: string, isTaken: (name: string) => boolean): string {
  const { base, extension } = splitExtension(name);
  let candidate = name;
  for (let counter = 2; isTaken(candidate); counter += 1) {
    candidate = extension === "" ? `${base}-${counter}` : `${base}-${counter}.${extension}`;
  }
  return candidate;
}

/// The timestamp in a pasted image's name, such as 20260919-143005, in local
/// time, with Western digits and the Gregorian calendar whatever the user's
/// region. The name is the native key "image-%@.png" in the user's language
/// ("imagem-%@.png" in Portuguese) with this as its %@, made unique with
/// uniqueDestination; the image is saved as PNG.
export function pastedImageTimestamp(now: Date): string {
  const twoDigits = (value: number) => String(value).padStart(2, "0");
  const date = String(now.getFullYear()).padStart(4, "0") + twoDigits(now.getMonth() + 1) + twoDigits(now.getDate());
  const time = twoDigits(now.getHours()) + twoDigits(now.getMinutes()) + twoDigits(now.getSeconds());
  return `${date}-${time}`;
}

/// Markdown for images at paths relative to the document's folder ("/"
/// between folders), one paragraph each, percent-encoding what URLs need.
export function imageMarkdown(relativePaths: readonly string[]): string {
  return relativePaths.map((path) => `![](${percentEncoded(path) ?? path})`).join("\n\n");
}

/// The images' Markdown in place of `range` (where they were dropped, or the
/// selection for a paste), with the caret after it.
export function imageInsertion(relativePaths: readonly string[], range: TextRange): TextEdit {
  const markdown = imageMarkdown(relativePaths);
  return {
    range,
    replacement: markdown,
    selection: { location: range.location + markdown.length, length: 0 },
  };
}

function withSlashes(path: string): string {
  return path.replaceAll("\\", "/");
}

/// The last component of a path, trailing separators aside.
function lastPathComponent(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1);
}

/// A file name's extension the way NSString finds it: after the last dot,
/// when a name that isn't only dots comes before it (".png" is a hidden file
/// with no extension) and the extension has no space.
function splitExtension(name: string): { base: string; extension: string } {
  const dot = name.lastIndexOf(".");
  const base = name.slice(0, dot);
  const extension = name.slice(dot + 1);
  if (dot === -1 || /^\.*$/.test(base) || extension === "" || extension.includes(" ")) {
    return { base: name, extension: "" };
  }
  return { base, extension };
}

// Foundation's urlPathAllowed as addingPercentEncoding applies it: ASCII
// letters and digits and these marks stay; anything else, non-ASCII
// included, is escaped as UTF-8.
const pathAllowed = /^[A-Za-z0-9!$&'()*+,\-./:;=@_~]$/;
const loneSurrogate = /^[\uD800-\uDFFF]$/;

/// `path` escaped for a Markdown link, or null when it holds half of a
/// surrogate pair, which has no UTF-8 to escape.
function percentEncoded(path: string): string | null {
  const firstSlash = path.indexOf("/");
  let encoded = "";
  let index = 0;
  for (const character of path) {
    // A colon before the first slash would read as a URL scheme (a:b.png),
    // so Foundation escapes it there.
    const readsAsScheme = character === ":" && (firstSlash === -1 || index < firstSlash);
    if (pathAllowed.test(character) && !readsAsScheme) {
      encoded += character;
    } else if (loneSurrogate.test(character)) {
      return null;
    } else {
      encoded += encodeURIComponent(character);
    }
    index += character.length;
  }
  return encoded;
}
