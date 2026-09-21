import { type BrowserWindow, dialog } from "electron";
import type { Strings } from "../shared/i18n";

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
