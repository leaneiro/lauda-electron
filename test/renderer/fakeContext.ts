import type { LaudaAPI } from "../../src/preload/bridge";
import { WindowContext } from "../../src/renderer/context";
import { Strings } from "../../src/shared/i18n";
import type { RequestChannel, Requests } from "../../src/shared/ipc";

export type Handlers = {
  [C in RequestChannel]?: (...args: Requests[C]["args"]) => Requests[C]["result"] | Promise<Requests[C]["result"]>;
};

export interface Request {
  channel: RequestChannel;
  args: unknown[];
}

/// A window context in English on a Mac, whose main process answers with
/// the handlers given (nothing, for a request without one) and keeps each
/// request it was sent.
export function fakeContext(handlers: Handlers = {}): { context: WindowContext; requests: Request[] } {
  const requests: Request[] = [];
  const invoke = async (channel: RequestChannel, ...args: unknown[]) => {
    requests.push({ channel, args });
    const handler = handlers[channel] as ((...args: unknown[]) => unknown) | undefined;
    return handler?.(...args);
  };
  const lauda: LaudaAPI = {
    invoke: invoke as LaudaAPI["invoke"],
    on: () => () => {},
    pathForFile: () => "",
  };
  return { context: new WindowContext(lauda, new Strings("en", true), "darwin"), requests };
}
