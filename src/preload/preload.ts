import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { EventChannel, Events, RequestChannel, Requests } from "../shared/ipc";

/// The only way the window reaches the main process: named requests and
/// events, nothing else of Electron or Node.
const api = {
  invoke<C extends RequestChannel>(channel: C, ...args: Requests[C]["args"]): Promise<Requests[C]["result"]> {
    return ipcRenderer.invoke(channel, ...args);
  },
  on<C extends EventChannel>(channel: C, listener: (payload: Events[C]) => void): () => void {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: Events[C]) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  /// The path of a file dropped on the window, which the sandbox hides.
  pathForFile(file: File): string {
    return webUtils.getPathForFile(file);
  },
};

contextBridge.exposeInMainWorld("lauda", api);

export type LaudaAPI = typeof api;
