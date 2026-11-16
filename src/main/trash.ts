import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { type TrashPlaces, type TrashSurroundings, trashPlacesFor } from "../shared/document";

/// What stays the same of a file when it is moved or renamed on its
/// volume: the system's own number for it. A path says where a file was;
/// this says which file it is, which is how a document finds its file in
/// the Trash, where Windows gives it another name.
export interface FileIdentity {
  volume: bigint;
  file: bigint;
}

export async function identityOf(filePath: string): Promise<FileIdentity | null> {
  try {
    const stats = await stat(filePath, { bigint: true });
    return { volume: stats.dev, file: stats.ino };
  } catch {
    return null;
  }
}

export function isSameFile(one: FileIdentity, other: FileIdentity | null): boolean {
  return other !== null && one.volume === other.volume && one.file === other.file;
}

/// This process's surroundings, as the rules about the Trash need them.
/// LAUDA_TRASH names a folder to stand for the Trash, for the tests.
export function trashSurroundings(): TrashSurroundings {
  return {
    platform: process.platform as TrashSurroundings["platform"],
    home: homedir(),
    uid: process.getuid?.(),
    dataHome: process.env.XDG_DATA_HOME,
    override: process.env.LAUDA_TRASH,
  };
}

export function trashPlacesOf(filePath: string): TrashPlaces {
  return trashPlacesFor(filePath, trashSurroundings());
}

async function entriesOf(folder: string): Promise<string[]> {
  try {
    return (await readdir(folder)).map((name) => join(folder, name));
  } catch {
    // Not there, or not this user's to read: nothing of theirs is in it.
    return [];
  }
}

/// Where in these folders the file is, by which file it is, or null.
export async function findIn(identity: FileIdentity, folders: string[]): Promise<string | null> {
  for (const folder of folders) {
    for (const entry of await entriesOf(folder)) {
      if (isSameFile(identity, await identityOf(entry))) return entry;
    }
  }
  return null;
}

/// Where the file is in the Trash, and the Trash folder whose entry holds
/// it: the file itself, or a folder above it thrown away with it inside.
export interface FoundInTrash {
  at: string;
  place: string;
}

/// Where in the Trash the file is, or null when it is in none of the
/// places. Every entry is asked which file it is, and an entry that is a
/// folder is looked into along the file's own path, for a folder above the
/// file thrown away whole (Windows renames the folder, not what is in it).
/// A Trash holds what the reader threw away and forgot, hundreds at most,
/// and this runs when a document's file disappears, not while typing.
export async function findInTrash(
  identity: FileIdentity,
  places: TrashPlaces,
  filePath: string,
): Promise<FoundInTrash | null> {
  const perUser = (await Promise.all(places.perUserParents.map(entriesOf))).flat();
  const below = filePath.split(/[\\/]/).filter((part) => part !== "");
  for (const place of [...places.folders, ...perUser]) {
    for (const entry of await entriesOf(place)) {
      if (isSameFile(identity, await identityOf(entry))) return { at: entry, place };
      for (let depth = 1; depth < below.length; depth++) {
        const inside = join(entry, ...below.slice(below.length - depth));
        if (isSameFile(identity, await identityOf(inside))) return { at: inside, place };
      }
    }
  }
  return null;
}
