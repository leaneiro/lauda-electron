// What the app lets documents reach (ContentPolicy.swift): the image files it
// imports and serves to the preview, and the link schemes allowed to leave
// the app.

/// File extensions the app treats as images: dropped or pasted into the
/// editor, and served to the preview from the document's folder.
export const imageFileExtensions: ReadonlySet<string> = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff", "tif", "heic", "avif", "svg", "ico",
]);

/// Whether a file path names an image, by its extension (ImageFileTypes.isImage).
export function isImagePath(path: string): boolean {
  return imageFileExtensions.has(pathExtension(path).toLowerCase());
}

/// The scheme the preview loads the document's own images and media from
/// (DocumentSchemeHandler.scheme).
export const documentScheme = "lauda-doc";

/// Link schemes allowed to leave the app: the renderer keeps them, clicks in
/// the preview open them in the browser, and pasting one over a selection
/// makes a link (ExternalLinks.allowedSchemes).
export const allowedLinkSchemes: ReadonlySet<string> = new Set(["http", "https", "mailto"]);

/// URL.pathExtension: what follows the last dot of the last component,
/// where a leading dot (".png", a hidden file) starts no extension. Both
/// separators count, since the main process also runs on Windows.
function pathExtension(path: string): string {
  const component = path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
  const dot = component.lastIndexOf(".");
  return dot > 0 ? component.slice(dot + 1) : "";
}
