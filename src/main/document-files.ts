import { realpathSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { isImagePath } from "../shared/markdown";

/// Where a document's preview may load `requestPath` from: inside its
/// folder only, and only images (DocumentSchemeHandler.swift). Symlinks
/// resolve on both sides, so a link inside the folder can't serve a file
/// from outside it, and a document's raw HTML can't read other local files.
export function resolveDocumentFile(folder: string, requestPath: string): string | null {
  let relative: string;
  try {
    relative = decodeURIComponent(requestPath).replace(/^\/+/, "");
  } catch {
    return null;
  }
  if (!relative) return null;
  let base: string;
  let target: string;
  try {
    base = realpathSync(folder);
    target = realpathSync(resolve(base, relative));
  } catch {
    return null;
  }
  if (target !== base && !target.startsWith(base + sep)) return null;
  if (!isImagePath(target)) return null;
  return target;
}

/// What the app's own scheme serves for `requestPath`: a file inside the
/// built app (`distDirectory`), or why not. A path that climbs out of it,
/// however it is spelled, or that doesn't decode, gets nothing.
export function resolveAppFile(distDirectory: string, requestPath: string): { file: string } | { status: 400 | 403 } {
  let pathname: string;
  try {
    pathname = decodeURIComponent(requestPath);
  } catch {
    return { status: 400 };
  }
  const file = resolve(distDirectory, `.${pathname}`);
  if (!file.startsWith(distDirectory + sep)) return { status: 403 };
  return { file };
}

/// A save panel's answer with `extension` when the name was typed without
/// one. Windows and macOS add the type's extension themselves; the GTK
/// panel on Linux keeps the name as typed.
export function pathWithExtension(path: string, extension: string): string {
  return extname(path) ? path : `${path}.${extension}`;
}
