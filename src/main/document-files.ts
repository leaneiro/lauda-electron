import { realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
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
