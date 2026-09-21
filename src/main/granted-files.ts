import { extname, resolve } from "node:path";

/// The files the window may write to, move, watch or keep images beside:
/// the ones this process handed it, by opening them, saving them as, or
/// renaming or moving them. The window names files by path, and a window
/// taken over by a bug in the page must not be able to name any other file
/// on the disk and have it written over.
export class GrantedFiles {
  private readonly paths = new Set<string>();

  grant(filePath: string): void {
    this.paths.add(resolve(filePath));
  }

  revoke(filePath: string): void {
    this.paths.delete(resolve(filePath));
  }

  has(filePath: unknown): filePath is string {
    return typeof filePath === "string" && filePath !== "" && this.paths.has(resolve(filePath));
  }
}

/// What the window may ask to open by path, which is what a drop hands it:
/// Markdown and plain text, never a file of any other kind.
export function isOpenableByPath(filePath: unknown, extensions: readonly string[]): filePath is string {
  if (typeof filePath !== "string" || filePath === "") return false;
  const extension = extname(filePath).slice(1).toLowerCase();
  return extensions.includes(extension);
}
