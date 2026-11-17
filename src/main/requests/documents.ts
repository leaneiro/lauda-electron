import { copyFile, rename, rm } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { app, type BrowserWindow, dialog, type IpcMainInvokeEvent, shell } from "electron";
import type { Strings } from "../../shared/i18n";
import { isImagePath } from "../../shared/markdown/content-policy";
import { askWhereToSave, messageOf, showError, showMessage, showWarning } from "../dialogs";
import { type DocumentWatcher, writeAtomically } from "../files";
import type { GrantedFiles } from "../granted-files";
import { freePathIn, importImages, savePastedImage } from "../images";
import { forgetDocumentFolder, registerDocumentFolder } from "../protocols";
import { type RecentFiles, sessionFile } from "../store";
import { handle, notGranted } from "./handle";

/// Nothing written, and no failure to tell: the file is not where the write
/// was asked, and the news of where it went is on its way to the window.
const withheld = { ok: false, withheld: true } as const;

/// What the document requests work with: the files the window was handed,
/// the watcher that tells of changes made elsewhere, the recent files, the
/// strings, and the window a request came from.
export interface DocumentRequestContext {
  granted: GrantedFiles;
  watcher: DocumentWatcher;
  recentFiles: RecentFiles;
  strings: Strings;
  windowFor: (event: IpcMainInvokeEvent) => BrowserWindow;
  /// The questions about closing a document whose file is in the Trash,
  /// by file, so the file being deleted from the Trash can take its
  /// question down (TRASH-01.16).
  closingQuestions: Map<string, AbortController>;
}

/// Writing, saving as, renaming, moving and watching documents, the
/// questions asked about them, and the images brought in beside them.
export function registerDocumentRequests({
  granted,
  watcher,
  recentFiles,
  strings,
  windowFor,
  closingQuestions,
}: DocumentRequestContext): void {
  handle("doc:register-folder", (_event, documentId, filePath) =>
    registerDocumentFolder(documentId, granted.has(filePath) ? dirname(filePath) : null),
  );
  handle("doc:forget-folder", (_event, documentId) => forgetDocumentFolder(documentId));
  handle("doc:write", async (_event, filePath, text) => {
    // Renamed or moved before the window heard (a write already on its way
    // under the old name): the document follows the new name, and the old
    // one is not to be made again.
    if (!granted.has(filePath)) return granted.wasLeft(filePath) ? withheld : notGranted;
    // Asked of the disk now, not of what the watcher last heard: the
    // autosave can come before the news that the file was thrown away,
    // and would make the file again where it was.
    if (await watcher.isInTrashNow(filePath)) return withheld;
    // Renamed by another program while that was asked.
    if (!granted.has(filePath)) return withheld;
    try {
      await writeAtomically(filePath, text);
      await watcher.noteWritten(filePath, text);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: messageOf(error) };
    }
  });
  handle("doc:save-as", async (event, request) => {
    const window = windowFor(event);
    const directory = request.directory ?? app.getPath("documents");
    const name = extname(request.title) ? request.title : `${request.title}.md`;
    const filePath = await askWhereToSave(
      window,
      { defaultPath: join(directory, name), filters: saveFilters(strings) },
      "md",
      strings,
    );
    if (!filePath) return null;
    try {
      await writeAtomically(filePath, request.text);
      recentFiles.note(filePath);
      granted.grant(filePath);
      // From now on a document with a file, watched as an opened one is.
      watcher.watch(filePath, request.text);
      await watcher.noteWritten(filePath, request.text);
      return filePath;
    } catch (error) {
      await showError(window, strings.t("Couldn't save “%@”", basename(filePath)), error, strings);
      return null;
    }
  });
  handle("doc:rename", async (event, filePath) => {
    if (!granted.has(filePath)) return null;
    const window = windowFor(event);
    const destination = await askWhereToSave(
      window,
      {
        title: strings.t("Rename"),
        buttonLabel: strings.t("Rename"),
        defaultPath: filePath,
        filters: saveFilters(strings),
      },
      extname(filePath).slice(1) || "md",
      strings,
    );
    if (!destination || destination === filePath) return null;
    try {
      await moveFile(filePath, destination);
      recentFiles.forget(filePath);
      recentFiles.note(destination);
      granted.revoke(filePath);
      granted.grant(destination);
      return destination;
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
    const result = await showMessage(windowFor(event), {
      type: "warning",
      message: strings.t("Do you want to save the changes you made to “%@”?", title),
      detail: strings.t("Your changes will be lost if you don't save them."),
      buttons: [strings.t("Save…"), strings.t("Don't Save"), strings.t("Cancel")],
      defaultId: 0,
      cancelId: 2,
    });
    return (["save", "dontSave", "cancel"] as const)[result.response] ?? "cancel";
  });
  // As NSDocument asks when its file changed under unsaved changes. Save
  // Anyway comes first and answers Escape: it keeps what the reader sees.
  handle("doc:ask-changed-elsewhere", async (event, title) => {
    const result = await showMessage(windowFor(event), {
      type: "warning",
      message: strings.t("“%@” was changed by another app.", title),
      detail: strings.t(
        "Save Anyway keeps your changes and replaces the other app's. Revert keeps the other app's changes and discards yours.",
      ),
      buttons: [strings.t("Save Anyway"), strings.t("Revert")],
      defaultId: 0,
      cancelId: 0,
    });
    return result.response === 1 ? "revert" : "saveAnyway";
  });
  handle("doc:show-in-trash", (_event, filePath) => {
    const inTrash = granted.has(filePath) ? watcher.trashedPathOf(filePath) : undefined;
    if (inTrash) shell.showItemInFolder(inTrash);
  });
  // As the native app asks: Close loses the edit, so it is neither the
  // default nor Escape's; Return and Escape both keep the document open.
  handle("doc:ask-close-in-trash", async (event, filePath, title) => {
    if (!granted.has(filePath) || closingQuestions.has(filePath)) return false;
    const question = new AbortController();
    closingQuestions.set(filePath, question);
    try {
      const result = await showMessage(windowFor(event), {
        type: "warning",
        message: strings.t("Close “%@” without saving?", title),
        detail: strings.t("The file is in the Trash, so your changes can't be saved. Put it back to keep them."),
        buttons: [strings.t("Close"), strings.t("Cancel")],
        defaultId: 1,
        cancelId: 1,
        signal: question.signal,
      });
      return result.response === 0 && !question.signal.aborted;
    } finally {
      closingQuestions.delete(filePath);
    }
  });
  handle("doc:ask-changed-in-trash", async (event, title) => {
    const result = await showMessage(windowFor(event), {
      type: "warning",
      message: strings.t("“%@” changed while it was in the Trash", title),
      detail: strings.t("Keep the changes you made here, or use the file as it is now?"),
      buttons: [strings.t("Keep My Changes"), strings.t("Use the File")],
      defaultId: 0,
      cancelId: 0,
    });
    return result.response === 1 ? "useFile" : "keep";
  });
  handle("doc:watch", (_event, filePath, text) => {
    if (granted.has(filePath)) watcher.watch(filePath, text);
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
    await showMessage(windowFor(event), {
      type: "info",
      message: strings.t("Save the document first"),
      // One short line: GTK lays out a wrapped detail flush left under a
      // centred message, which reads as misaligned.
      detail: strings.t("Images are copied to the document's folder."),
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
