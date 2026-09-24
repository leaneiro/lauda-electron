import { existsSync } from "node:fs";
import { basename } from "node:path";
import { type BrowserWindow, dialog } from "electron";
import type { Strings } from "../shared/i18n";
import { pathWithExtension } from "./document-files";

/// What an error says, whatever was thrown: a thrown Error's message, or
/// the thing itself written out.
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/// A warning on the window, with one button to dismiss it.
export async function showWarning(
  window: BrowserWindow,
  message: string,
  detail: string,
  strings: Strings,
): Promise<void> {
  await dialog.showMessageBox(window, { type: "warning", message, detail, buttons: [strings.t("OK")] });
}

/// A warning that something failed, with the error as its detail.
export async function showError(
  window: BrowserWindow,
  message: string,
  error: unknown,
  strings: Strings,
): Promise<void> {
  await showWarning(window, message, messageOf(error), strings);
}

/// A save panel, as the app's save panels all are: the type's extension on
/// a name typed without one (see pathWithExtension), and a question before
/// replacing a file. The panel asks about the name as typed, on Linux only
/// when told to; a file already there by the name with the extension added
/// is asked about here. Null when the reader cancels or keeps the file.
export async function askWhereToSave(
  window: BrowserWindow,
  options: Electron.SaveDialogOptions,
  extension: string,
  strings: Strings,
): Promise<string | null> {
  const result = await dialog.showSaveDialog(window, { ...options, properties: ["showOverwriteConfirmation"] });
  if (result.canceled || !result.filePath) return null;
  const destination = pathWithExtension(result.filePath, extension);
  if (destination === result.filePath || !existsSync(destination)) return destination;
  const answer = await dialog.showMessageBox(window, {
    type: "warning",
    message: strings.t("“%@” already exists. Do you want to replace it?", basename(destination)),
    buttons: [strings.t("Replace"), strings.t("Cancel")],
    defaultId: 1,
    cancelId: 1,
  });
  return answer.response === 0 ? destination : null;
}
