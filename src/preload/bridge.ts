import type { EventChannel, Events, RequestChannel, Requests } from "../shared/ipc";

/// What the preload hands the window: named requests and events, and the
/// path of a dropped file. The window compiles against this alone, never
/// against Electron, so nothing of Node can reach it by way of the bridge.
export interface LaudaAPI {
  invoke<C extends RequestChannel>(channel: C, ...args: Requests[C]["args"]): Promise<Requests[C]["result"]>;
  on<C extends EventChannel>(channel: C, listener: (payload: Events[C]) => void): () => void;
  /// The path of a file dropped on the window, which the sandbox hides.
  pathForFile(file: File): string;
}
