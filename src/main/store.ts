import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { app } from "electron";
import type { SessionContents } from "../shared/ipc";
import { defaultPreferences, type Settings, sanitizeSettings } from "../shared/settings";

/// A small JSON file in the app's data folder. Written atomically (a temporary
/// file, then a rename), so a crash mid-write never leaves half a file.
class JSONFile<T> {
  constructor(private readonly name: string) {}

  /// Worked out on use: the data folder is only settled once the app has
  /// started (tests and the Mac build choose their own).
  private get path(): string {
    return join(app.getPath("userData"), this.name);
  }

  read(): unknown {
    try {
      return JSON.parse(readFileSync(this.path, "utf8"));
    } catch {
      return undefined;
    }
  }

  write(value: T): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${process.pid}.tmp`;
      writeFileSync(temporary, JSON.stringify(value, null, 2));
      renameSync(temporary, this.path);
    } catch (error) {
      console.error(`Writing ${this.path}:`, error);
    }
  }
}

/// Every setting, with the native app's defaults.
export class SettingsStore {
  private readonly file = new JSONFile<Settings>("settings.json");
  private current: Settings;
  private readonly listeners = new Set<(settings: Settings) => void>();

  constructor() {
    this.current = sanitizeSettings(this.file.read());
  }

  get value(): Settings {
    return this.current;
  }

  update(changes: Partial<Settings>): void {
    this.current = sanitizeSettings({ ...this.current, ...changes });
    this.file.write(this.current);
    for (const listener of this.listeners) listener(this.current);
  }

  /// Restore Defaults: every preference goes back to its default; what the
  /// app remembers (the view mode, the welcome guide) stays.
  restoreDefaults(): void {
    this.update(defaultPreferences);
  }

  onChange(listener: (settings: Settings) => void): void {
    this.listeners.add(listener);
  }
}

export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

/// Where the window was, as the native window's frame autosave keeps it.
export const windowStateFile = new JSONFile<WindowState>("window-state.json");

export function readWindowState(): WindowState | undefined {
  const stored = windowStateFile.read() as Partial<WindowState> | undefined;
  if (!stored || typeof stored.width !== "number" || typeof stored.height !== "number") return undefined;
  return {
    x: typeof stored.x === "number" ? stored.x : undefined,
    y: typeof stored.y === "number" ? stored.y : undefined,
    width: stored.width,
    height: stored.height,
    maximized: stored.maximized === true,
  };
}

/// The tabs the reader left open, which come back at the next launch.
export const sessionFile = new JSONFile<SessionContents>("session.json");

export function readSession(): SessionContents {
  const stored = sessionFile.read() as Partial<SessionContents> | undefined;
  const files = Array.isArray(stored?.files) ? stored.files.filter((f): f is string => typeof f === "string") : [];
  const selected = typeof stored?.selected === "string" ? stored.selected : null;
  return { files, selected };
}

/// Open Recent, most recent first.
export class RecentFiles {
  private static readonly limit = 10;
  private readonly file = new JSONFile<string[]>("recent-files.json");
  private files: string[];
  private readonly listeners = new Set<() => void>();

  constructor() {
    const stored = this.file.read();
    this.files = Array.isArray(stored) ? stored.filter((f): f is string => typeof f === "string") : [];
  }

  get list(): readonly string[] {
    return this.files;
  }

  note(filePath: string): void {
    this.files = [filePath, ...this.files.filter((f) => f !== filePath)].slice(0, RecentFiles.limit);
    this.file.write(this.files);
    app.addRecentDocument(filePath);
    this.changed();
  }

  forget(filePath: string): void {
    this.files = this.files.filter((f) => f !== filePath);
    this.file.write(this.files);
    this.changed();
  }

  clear(): void {
    this.files = [];
    this.file.write(this.files);
    app.clearRecentDocuments();
    this.changed();
  }

  onChange(listener: () => void): void {
    this.listeners.add(listener);
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }
}
