import { type IpcMainInvokeEvent, ipcMain } from "electron";
import type { RequestChannel, Requests } from "../../shared/ipc";
import { appOrigin } from "../protocols";

/// Requests come from the app's own pages only: the window and Settings.
/// The preview is a frame of another origin, with no bridge, and a page that
/// somehow navigated elsewhere gets nothing either.
export function isFromTheApp(event: IpcMainInvokeEvent): boolean {
  return event.senderFrame?.url.startsWith(`${appOrigin}/`) ?? false;
}

export function handle<C extends RequestChannel>(
  channel: C,
  handler: (
    event: IpcMainInvokeEvent,
    ...args: Requests[C]["args"]
  ) => Promise<Requests[C]["result"]> | Requests[C]["result"],
): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isFromTheApp(event)) throw new Error(`${channel} refused: not asked by the app`);
    return handler(event, ...(args as Requests[C]["args"]));
  });
}

/// What a request about a file the window wasn't handed gets back.
export const notGranted = { ok: false as const, error: "Not a file this window opened" };
