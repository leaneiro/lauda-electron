import { copyFile, rename, rm } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { app, type BrowserWindow, dialog, type IpcMainInvokeEvent } from "electron";
import type { Strings } from "../../shared/i18n";
import { isImagePath } from "../../shared/markdown/content-policy";
import { messageOf, showError, showWarning } from "../dialogs";
import { type DocumentWatcher, writeText } from "../files";
import type { GrantedFiles } from "../granted-files";
import { freePathIn, importImages, savePastedImage } from "../images";
import { forgetDocumentFolder, registerDocumentFolder } from "../protocols";
import { type RecentFiles, sessionFile } from "../store";
import { handle, notGranted } from "./handle";

/// What the document requests work with: the files the window was handed,
/// the watcher that tells of changes made elsewhere, the recent files, the
/// strings, and the window a request came from.
export interface DocumentRequestContext {
  granted: GrantedFiles;
  watcher: DocumentWatcher;
  recentFiles: RecentFiles;
  strings: Strings;
  windowFor: (event: IpcMainInvokeEvent) => BrowserWindow;
}

/// Writing, saving as, renaming, moving and watching documents, the
/// questions asked about them, and the images brought in beside them.
export function registerDocumentRequests({
  granted,
  watcher,
  recentFiles,
  strings,
  windowFor,
}: DocumentRequestContext): void {
  handle("doc:register-folder", (_event, documentId, filePath) =>
    registerDocumentFolder(documentId, granted.has(filePath) ? dirname(filePath) : null),
  );
  handle("doc:forget-folder", (_event, documentId) => forgetDocumentFolder(documentId));
  handle("doc:write", async (_event, filePath, text) => {
    if (!granted.has(filePath)) return notGranted;
    try {
      watcher.noteWritten(filePath, text);
      await writeText(filePath, text);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: messageOf(error) };
    }
  });
  handle("doc:save-as", async (event, request) => {
    const window = windowFor(event);
    const directory = request.directory ?? app.getPath("documents");
    const name = extname(request.title) ? request.title : `${request.title}.md`;
    const result = await dialog.showSaveDialog(window, {
      defaultPath: join(directory, name),
      filters: saveFilters(strings),
    });
    if (result.canceled || !result.filePath) return null;
    try {
      watcher.noteWritten(result.filePath, request.text);
      await writeText(result.filePath, request.text);
      recentFiles.note(result.filePath);
      granted.grant(result.filePath);
      return result.filePath;
    } catch (error) {
      await showError(window, strings.t("Couldn't save “%@”", basename(result.filePath)), error, strings);
      return null;
    }
  });
  handle("doc:rename", async (event, filePath) => {
    if (!granted.has(filePath)) return null;
    const window = windowFor(event);
    const result = await dialog.showSaveDialog(window, {
      title: strings.t("Rename"),
      buttonLabel: strings.t("Rename"),
      defaultPath: filePath,
      filters: saveFilters(strings),
    });
    if (result.canceled || !result.filePath || result.filePath === filePath) return null;
    try {
      await moveFile(filePath, result.filePath);
      recentFiles.forget(filePath);
      recentFiles.note(result.filePath);
      granted.revoke(filePath);
      granted.grant(result.filePath);
      return result.filePath;
    } catch (error) {
      await showError(window, strings.t("Couldn't rename “%@”", basename(filePath)), error, strings);
      return null;
    }
  });
  handle("doc:move", async (event, filePath) => {
    if (!granted.has(filePath)) return null;
    const window = windowFor(event);
    const result = await dialog.showOpenDialog(window, {
      title: strings.t("Move To…").replace(/…$/, ""),
      buttonLabel: strings.t("Move"),
      defaultPath: dirname(filePath),
      properties: ["openDirectory", "createDirectory"],
    });
    const folder = result.filePaths[0];
    if (result.canceled || !folder || folder === dirname(filePath)) return null;
    const destination = freePathIn(folder, basename(filePath));
    try {
      await moveFile(filePath, destination);
      recentFiles.forget(filePath);
      recentFiles.note(destination);
      granted.revoke(filePath);
      granted.grant(destination);
      return destination;
    } catch (error) {
      await showError(window, strings.t("Couldn't move “%@”", basename(filePath)), error, strings);
      return null;
    }
  });
  handle("doc:ask-save-changes", async (event, title) => {
    const result = await dialog.showMessageBox(windowFor(event), {
      type: "warning",
      message: strings.t("Do you want to save the changes you made to “%@”?", title),
      detail: strings.t("Your changes will be lost if you don't save them."),
      buttons: [strings.t("Save…"), strings.t("Don't Save"), strings.t("Cancel")],
      defaultId: 0,
      cancelId: 2,
    });
    return (["save", "dontSave", "cancel"] as const)[result.response] ?? "cancel";
  });
  handle("doc:ask-revert", async (event, title) => {
    const result = await dialog.showMessageBox(windowFor(event), {
      type: "warning",
      message: strings.t("Revert to the last saved version of “%@”?", title),
      detail: strings.t("Your current changes will be lost."),
      buttons: [strings.t("Revert"), strings.t("Cancel")],
      defaultId: 0,
      cancelId: 1,
    });
    return result.response === 0;
  });
  handle("doc:watch", (_event, filePath) => {
    if (granted.has(filePath)) watcher.watch(filePath);
  });
  handle("doc:unwatch", (_event, filePath) => watcher.unwatch(filePath));
  handle("doc:show-error", async (event, message, detail) => {
    await showWarning(windowFor(event), message, detail, strings);
  });

  handle("session:store", (_event, session) => sessionFile.write(session));

  handle("images:import", (_event, documentPath, files) => {
    if (!granted.has(documentPath)) return { paths: [], error: notGranted.error };
    return importImages(
      documentPath,
      files.filter((file) => typeof file === "string" && isImagePath(file)),
    );
  });
  handle("images:save-pasted", (_event, documentPath, png) => {
    if (!granted.has(documentPath)) return { paths: [], error: notGranted.error };
    return savePastedImage(documentPath, png, strings);
  });
  handle("images:ask-save-first", async (event) => {
    await dialog.showMessageBox(windowFor(event), {
      type: "info",
      message: strings.t("Save the document first"),
      detail: strings.t("Images are copied to the document's folder, so save the file before adding images."),
      buttons: [strings.t("OK")],
    });
  });
}

function saveFilters(strings: Strings) {
  return [
    { name: strings.t("Markdown Document"), extensions: ["md", "markdown"] },
    { name: strings.t("Plain Text"), extensions: ["txt"] },
  ];
}

async function moveFile(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    await copyFile(from, to);
    await rm(from);
  }
}
