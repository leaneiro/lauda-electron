import { type FSWatcher, watch } from "node:fs";
import { readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { isInsideTrash, type TrashPlaces } from "../shared/document";
import { logFailure } from "./log";
import { type FileIdentity, findIn, findInTrash, identityOf, trashPlacesOf } from "./trash";

/// Strict UTF-8 with a Latin-1 fallback, never lossy, so a save can't
/// silently corrupt a file that came in another encoding (as the native
/// MarkdownDocument.decode).
export function decodeText(data: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data).replace(/^\uFEFF/, "");
  } catch {
    return new TextDecoder("latin1").decode(data);
  }
}

export async function readText(filePath: string): Promise<string> {
  return decodeText(await readFile(filePath));
}

/// Windows refuses, for a moment, to replace a file another program holds
/// open (an antivirus, the search indexer, a sync client), and these are
/// the codes it says so with. It lets go within tens of milliseconds, so
/// the step is tried again rather than the save failing.
const transientCodes = new Set(["EPERM", "EBUSY", "EACCES"]);

export async function retryingTransientErrors<T>(
  operation: () => Promise<T>,
  delays: readonly number[] = [10, 30, 60, 120, 250],
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms)),
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      const delay = delays[attempt];
      if (delay === undefined || !code || !transientCodes.has(code)) throw error;
      await sleep(delay);
    }
  }
}

/// Writes through a temporary file in the same folder and renames it over
/// the file, so a crash or a full disk never leaves half a file: a
/// document's text, or an exported page or PDF. The file keeps its
/// permissions when it existed. A file that is a symbolic link is written
/// where the link points, so the link stays a link rather than becoming a
/// copy of the file it pointed to.
export async function writeAtomically(filePath: string, contents: string | Uint8Array): Promise<void> {
  const target = await realpath(filePath).catch(() => filePath);
  const temporary = join(dirname(target), `.${basename(target)}.lauda-${process.pid}-${Date.now()}.tmp`);
  let mode: number | undefined;
  try {
    mode = (await stat(target)).mode;
  } catch {
    // A new file: it takes the folder's defaults.
  }
  try {
    await writeFile(temporary, contents, { encoding: "utf8", mode });
    await retryingTransientErrors(() => rename(temporary, target));
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/// What the watcher tells of a document's file.
export interface DocumentWatcherEvents {
  /// Another program changed the text.
  changed: (filePath: string, text: string) => void;
  /// The file went to the Trash.
  trashed: (filePath: string) => void;
  /// The file is back where it was, with this text.
  putBack: (filePath: string, text: string) => void;
  /// The file left the Trash without coming back: deleted for good.
  goneFromTrash: (filePath: string) => void;
  /// Another program renamed the file in its folder. The watcher stops
  /// watching the old name; who heard of it watches the new one.
  renamed: (from: string, to: string) => void;
}

interface WatchedFile {
  folderWatcher?: FSWatcher;
  trashWatcher?: FSWatcher;
  timer?: NodeJS.Timeout;
  lastWritten?: string;
  identity: FileIdentity | null;
  /// Where the file is while it is in the Trash.
  trashedAt?: string;
}

/// Watches open documents for what other programs do to their files:
/// a change of text, and the way to the Trash and back. The editor's own
/// writes are recognized by their text and ignored. A file is followed
/// into the Trash by which file it is, not by its name, and the Trash is
/// looked into only when a document's file disappears.
export class DocumentWatcher {
  private readonly files = new Map<string, WatchedFile>();

  constructor(
    private readonly events: DocumentWatcherEvents,
    private readonly placesOf: (filePath: string) => TrashPlaces = trashPlacesOf,
  ) {}

  private entry(filePath: string): WatchedFile {
    let entry = this.files.get(filePath);
    if (!entry) {
      entry = { identity: null };
      this.files.set(filePath, entry);
    }
    return entry;
  }

  noteWritten(filePath: string, text: string): void {
    this.entry(filePath).lastWritten = text;
  }

  /// A write replaces the file with a new one (see writeAtomically): which
  /// file it is has to be asked again.
  async noteWriteDone(filePath: string): Promise<void> {
    const entry = this.files.get(filePath);
    if (entry) entry.identity = await identityOf(filePath);
  }

  watch(filePath: string): void {
    const entry = this.entry(filePath);
    if (entry.folderWatcher) return;
    entry.folderWatcher = this.watchFolder(dirname(filePath), basename(filePath), () => this.scheduleCheck(filePath));
    void identityOf(filePath).then((identity) => {
      entry.identity ??= identity;
      // Opened from inside the Trash: there from the start.
      if (isInsideTrash(filePath) && !entry.trashedAt && this.files.get(filePath) === entry) {
        entry.trashedAt = filePath;
        this.events.trashed(filePath);
      }
    });
  }

  /// The folder is watched, not the file: saving through a rename (as
  /// this app and most editors do) replaces the file a watcher follows.
  /// With a name, only what happens to that name counts.
  private watchFolder(folder: string, name: string | null, onEvent: () => void): FSWatcher | undefined {
    try {
      const watcher = watch(folder, (_event, changed) => {
        if (name && changed && changed.toString() !== name) return;
        onEvent();
      });
      watcher.on("error", (error) => {
        logFailure("files", "Watching a document's folder", error);
        watcher.close();
      });
      return watcher;
    } catch (error) {
      // On Linux, most often the system's limit on watches (inotify) being
      // reached: changes made elsewhere stop showing, and this says why.
      logFailure("files", "Watching a document's folder", error);
      return undefined;
    }
  }

  unwatch(filePath: string): void {
    const entry = this.files.get(filePath);
    if (!entry) return;
    entry.folderWatcher?.close();
    entry.trashWatcher?.close();
    clearTimeout(entry.timer);
    this.files.delete(filePath);
  }

  /// Where the file is in the Trash, while it is there.
  trashedPathOf(filePath: string): string | undefined {
    return this.files.get(filePath)?.trashedAt;
  }

  isInTrash(filePath: string): boolean {
    return this.files.get(filePath)?.trashedAt !== undefined;
  }

  /// Looks at the file now and says whether it is in the Trash: before a
  /// write, which would otherwise make the file again where it was.
  /// Only where the file is counts here, not what it holds: reading it
  /// would take the text the write is about to replace for another
  /// program's change.
  async isInTrashNow(filePath: string): Promise<boolean> {
    const entry = this.files.get(filePath);
    if (!entry) return false;
    if (await identityOf(filePath)) return false;
    await this.fileIsNotThere(filePath, entry);
    return this.isInTrash(filePath);
  }

  /// Looks at every file again: what a watcher missed (a folder that can't
  /// be watched, a limit reached) is caught when the window comes forward.
  checkAll(): void {
    for (const filePath of this.files.keys()) this.scheduleCheck(filePath);
  }

  private scheduleCheck(filePath: string): void {
    const entry = this.files.get(filePath);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => void this.check(filePath), 250);
  }

  private async check(filePath: string): Promise<void> {
    const entry = this.files.get(filePath);
    if (!entry) return;
    let text: string;
    try {
      text = await readText(filePath);
    } catch {
      await this.fileIsNotThere(filePath, entry);
      return;
    }
    if (this.files.get(filePath) !== entry) return;
    entry.identity = await identityOf(filePath);
    if (entry.trashedAt && entry.trashedAt !== filePath) {
      entry.trashedAt = undefined;
      entry.trashWatcher?.close();
      entry.trashWatcher = undefined;
      entry.lastWritten = text;
      this.events.putBack(filePath, text);
      return;
    }
    if (text === entry.lastWritten) return;
    entry.lastWritten = text;
    this.events.changed(filePath, text);
  }

  private async fileIsNotThere(filePath: string, entry: WatchedFile): Promise<void> {
    if (!entry.identity) return;
    const trashedAt = await findInTrash(entry.identity, this.placesOf(filePath));
    if (this.files.get(filePath) !== entry) return;
    if (trashedAt) {
      if (entry.trashedAt === trashedAt) return;
      const wasInTrash = entry.trashedAt !== undefined;
      entry.trashedAt = trashedAt;
      entry.trashWatcher?.close();
      entry.trashWatcher = this.watchFolder(dirname(trashedAt), null, () => this.scheduleCheck(filePath));
      if (!wasInTrash) this.events.trashed(filePath);
      return;
    }
    // Not where it was and in no Trash. Out of the Trash that way, it is
    // gone. Never having been there, it may have been renamed in its
    // folder, which the document follows; moved elsewhere or deleted, this
    // edition leaves it as it always did.
    if (entry.trashedAt === undefined) {
      const renamedTo = await findIn(entry.identity, [dirname(filePath)]);
      if (!renamedTo || this.files.get(filePath) !== entry) return;
      this.unwatch(filePath);
      this.events.renamed(filePath, renamedTo);
      return;
    }
    this.unwatch(filePath);
    this.events.goneFromTrash(filePath);
  }
}
