import type { Locale } from "./i18n";
import type { Settings, ViewMode } from "./settings";

/// What the window asks the main process (ipcRenderer.invoke), with the
/// arguments each request takes and what it answers.
export interface Requests {
  "app:init": { args: []; result: InitialState };
  "app:show-settings": { args: []; result: void };
  "settings:fit-window": { args: [height: number]; result: void };
  "app:open-external": { args: [url: string]; result: void };
  "app:list-fonts": { args: []; result: string[] };
  "app:read-clipboard": { args: []; result: string };
  "app:open-files": { args: [paths: string[]]; result: void };
  "window:set-document": { args: [info: WindowDocumentInfo]; result: void };
  "window:title-bar-double-click": { args: []; result: void };
  "window:show-menu": { args: [x: number, y: number]; result: void };
  "window:closed-everything": { args: [ok: boolean]; result: void };
  "doc:register-folder": { args: [documentId: string, filePath: string | null]; result: string };
  "doc:forget-folder": { args: [documentId: string]; result: void };
  "doc:read": { args: [filePath: string]; result: ReadResult };
  "doc:write": { args: [filePath: string, text: string]; result: WriteResult };
  "doc:save-as": { args: [request: SaveAsRequest]; result: string | null };
  "doc:rename": { args: [filePath: string]; result: string | null };
  "doc:move": { args: [filePath: string]; result: string | null };
  "doc:ask-save-changes": { args: [title: string]; result: "save" | "dontSave" | "cancel" };
  "doc:ask-revert": { args: [title: string]; result: boolean };
  "doc:watch": { args: [filePath: string]; result: void };
  "doc:unwatch": { args: [filePath: string]; result: void };
  "doc:show-error": { args: [message: string, detail: string]; result: void };
  "session:store": { args: [session: SessionContents]; result: void };
  "images:import": { args: [documentPath: string, files: string[]]; result: ImageImportResult };
  "images:save-pasted": { args: [documentPath: string, png: Uint8Array]; result: ImageImportResult };
  "images:ask-save-first": { args: []; result: void };
  "export:html": { args: [request: ExportRequest]; result: void };
  "export:pdf": { args: [request: ExportRequest]; result: void };
  "settings:set": { args: [changes: Partial<Settings>]; result: void };
  "settings:restore-defaults": { args: []; result: void };
  "menu:set-state": { args: [state: MenuState]; result: void };
}

/// What the main process tells the window (webContents.send).
export interface Events {
  "menu:command": MenuCommand;
  "workspace:open": OpenDocument;
  "workspace:close-everything": { reason: "window" | "quit" };
  "settings:changed": Settings;
  "doc:changed-on-disk": { filePath: string; text: string };
  "window:state": { isFullScreen: boolean; isFocused: boolean };
}

export type RequestChannel = keyof Requests;
export type EventChannel = keyof Events;

export type Platform = "darwin" | "win32" | "linux";

export interface InitialState {
  platform: Platform;
  locale: Locale;
  settings: Settings;
  version: string;
  gitHash: string;
  /// Room the system's window buttons take on the right (Windows and
  /// Linux draw them over the title bar), in CSS pixels.
  windowControlsWidth: number;
}

/// A document the window should show as a tab, selecting it if it is
/// already open.
export interface OpenDocument {
  filePath: string | null;
  text: string;
  /// For a document without a file: the welcome guide or a duplicate.
  title?: string;
  /// Marks the text as the reader's own change, as a duplicate's is.
  edited?: boolean;
}

export interface ReadResult {
  ok: boolean;
  text?: string;
  error?: string;
}

export interface WriteResult {
  ok: boolean;
  error?: string;
}

export interface SaveAsRequest {
  title: string;
  text: string;
  /// Where the save panel starts: the folder the document came from.
  directory: string | null;
}

export interface SessionContents {
  files: string[];
  selected: string | null;
}

export interface ImageImportResult {
  paths: string[];
  error?: string;
}

export interface ExportRequest {
  title: string;
  markdown: string;
  filePath: string | null;
}

export interface WindowDocumentInfo {
  title: string;
  filePath: string | null;
  edited: boolean;
}

export interface MenuState {
  hasDocument: boolean;
  hasFile: boolean;
  documentCount: number;
  viewMode: ViewMode;
}

export type MenuCommand =
  | { name: "new" }
  | { name: "close" }
  | { name: "save" }
  | { name: "duplicate" }
  | { name: "rename" }
  | { name: "move" }
  | { name: "revert" }
  | { name: "export-pdf" }
  | { name: "export-html" }
  | { name: "find" }
  | { name: "find-next" }
  | { name: "find-previous" }
  | { name: "find-replace" }
  | { name: "bold" }
  | { name: "italic" }
  | { name: "link" }
  | { name: "view-mode"; mode: ViewMode }
  | { name: "next-tab" }
  | { name: "previous-tab" };
