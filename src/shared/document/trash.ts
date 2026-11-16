import type { Platform } from "../ipc";

/// Where files go on their way out, on each system, and what a document
/// does when its file goes there, comes back or is gone for good (as the
/// native Trash.swift and MarkdownDocument's rules about the Trash).

const trashFolderNames = new Set([".Trash", ".Trashes", "$Recycle.Bin", "$RECYCLE.BIN"]);

function parts(filePath: string): string[] {
  return filePath.split(/[\\/]/).filter((part) => part !== "");
}

/// Whether `filePath` is inside a Trash: the home folder's, or the one a
/// volume keeps at its root. Told by the folders' names, as the native
/// app does for volumes, so a file opened straight from the Trash counts.
export function isInsideTrash(filePath: string): boolean {
  const folders = parts(filePath).slice(0, -1);
  return folders.some(
    (name, index) =>
      trashFolderNames.has(name) ||
      /^\.Trash-\d+$/.test(name) ||
      // Linux: ~/.local/share/Trash/files
      (name === "Trash" && folders[index + 1] === "files" && folders[index - 1] === "share"),
  );
}

export interface TrashSurroundings {
  platform: Platform;
  home: string;
  /// The user's number, where the system has one (not on Windows).
  uid?: number;
  /// $XDG_DATA_HOME, when set.
  dataHome?: string;
  /// A folder that stands for the Trash, for the tests: the real one is
  /// never theirs to touch.
  override?: string;
}

export interface TrashPlaces {
  /// Folders a trashed file may be directly in.
  folders: string[];
  /// Folders that hold one Trash per user (Windows keeps them by the
  /// user's id): each folder inside is a place to look.
  perUserParents: string[];
}

/// Where the system would put `filePath` when it is thrown away: the
/// user's own Trash, and the one of the volume the file is on. More
/// places than exist are named; looking in one that isn't there finds
/// nothing.
export function trashPlacesFor(filePath: string, surroundings: TrashSurroundings): TrashPlaces {
  const { platform, home, uid, dataHome, override } = surroundings;
  if (override) return { folders: [override], perUserParents: [] };
  if (platform === "win32") {
    const drive = /^[A-Za-z]:/.exec(filePath)?.[0];
    return { folders: [], perUserParents: drive ? [`${drive}\\$Recycle.Bin`] : [] };
  }
  if (platform === "darwin") {
    const volume = /^\/Volumes\/[^/]+/.exec(filePath)?.[0];
    const onVolume = volume && uid !== undefined ? [`${volume}/.Trashes/${uid}`] : [];
    return { folders: [`${home}/.Trash`, ...onVolume], perUserParents: [] };
  }
  const folders = [`${dataHome || `${home}/.local/share`}/Trash/files`];
  if (uid !== undefined) {
    // The volume's root is one of the folders above the file; which one
    // is the system's to know, so each is named.
    const above = parts(filePath).slice(0, -1);
    for (let depth = above.length; depth >= 0; depth--) {
      const root = `/${above.slice(0, depth).join("/")}`.replace(/\/$/, "");
      folders.push(`${root}/.Trash-${uid}/files`, `${root}/.Trash/${uid}/files`);
    }
  }
  return { folders, perUserParents: [] };
}

/// A file out of the Trash again. With nothing unsaved the document reads
/// it, since it may have changed there. Edits kept out of the Trash are
/// saved now when the file is as the document last knew it, and when both
/// changed only the reader knows which text to keep.
export function afterPutBack(document: { isEdited: boolean; savedText: string | null }, fileText: string) {
  if (!document.isEdited) return "read" as const;
  return fileText === document.savedText ? ("save" as const) : ("ask" as const);
}

/// A file deleted from the Trash leaves nothing to put back: a document
/// with nothing the reader could lose closes, and one with edits kept
/// becomes an untitled document holding them.
export function afterDeletedFromTrash(document: { isEdited: boolean }) {
  return document.isEdited ? ("untitled" as const) : ("close" as const);
}
