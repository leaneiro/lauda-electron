import { watch, type FSWatcher } from "node:fs";
import { readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/// Strict UTF-8 with a Latin-1 fallback, never lossy, so a save can't
/// silently corrupt a file that came in another encoding (as the native
/// MarkdownDocument.decode).
export function decodeText(data: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("latin1").decode(data);
  }
}

export async function readText(filePath: string): Promise<string> {
  return decodeText(await readFile(filePath));
}

/// Writes through a temporary file in the same folder and renames it over
/// the document, so a crash or a full disk never leaves half a file. The
/// file keeps its permissions when it existed.
export async function writeText(filePath: string, text: string): Promise<void> {
  const temporary = join(dirname(filePath), `.${basename(filePath)}.lauda-${process.pid}-${Date.now()}.tmp`);
  let mode: number | undefined;
  try {
    mode = (await stat(filePath)).mode;
  } catch {}
  try {
    await writeFile(temporary, text, { encoding: "utf8", mode });
    await rename(temporary, filePath);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/// Watches open documents for changes made by other programs. The editor's
/// own writes are recognized by their text and ignored.
export class DocumentWatcher {
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly lastWritten = new Map<string, string>();
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly onChange: (filePath: string, text: string) => void) {}

  noteWritten(filePath: string, text: string): void {
    this.lastWritten.set(filePath, text);
  }

  watch(filePath: string): void {
    if (this.watchers.has(filePath)) return;
    try {
      // The folder is watched, not the file: saving through a rename (as
      // this app and most editors do) replaces the file a watcher follows.
      const name = basename(filePath);
      const watcher = watch(dirname(filePath), (_event, changed) => {
        if (changed && changed.toString() !== name) return;
        this.scheduleCheck(filePath);
      });
      watcher.on("error", () => this.unwatch(filePath));
      this.watchers.set(filePath, watcher);
    } catch {}
  }

  unwatch(filePath: string): void {
    this.watchers.get(filePath)?.close();
    this.watchers.delete(filePath);
    this.lastWritten.delete(filePath);
    clearTimeout(this.timers.get(filePath));
    this.timers.delete(filePath);
  }

  private scheduleCheck(filePath: string): void {
    clearTimeout(this.timers.get(filePath));
    this.timers.set(filePath, setTimeout(() => void this.check(filePath), 250));
  }

  private async check(filePath: string): Promise<void> {
    let text: string;
    try {
      text = await readText(filePath);
    } catch {
      return;
    }
    if (text === this.lastWritten.get(filePath)) return;
    this.lastWritten.set(filePath, text);
    this.onChange(filePath, text);
  }
}
