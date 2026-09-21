import type { LaudaAPI } from "../preload/bridge";
import type { RenderedDocument } from "../shared/markdown";
import type { DocumentCounts, FromWorker, ToWorker } from "../shared/worker-protocol";

/// Spreads a request over the members of a union, so each keeps its own
/// fields once the id is taken off.
type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;

/// The window's worker (src/worker), one for every document: it renders them
/// for the preview and counts them for the status bar.
export class DocumentWorker {
  private readonly worker = new Worker("document-worker.js");
  private nextId = 1;
  private readonly waiting = new Map<number, (answer: FromWorker) => void>();

  constructor(private readonly lauda: LaudaAPI) {
    this.worker.onmessage = (event: MessageEvent<FromWorker>) => {
      const answer = event.data;
      this.waiting.get(answer.id)?.(answer);
      this.waiting.delete(answer.id);
    };
  }

  /// The preview's HTML, or null when the document couldn't be rendered.
  async render(markdown: string, strictLineBreaks: boolean): Promise<RenderedDocument | null> {
    const answer = await this.request({ type: "render", markdown, strictLineBreaks });
    if (answer.type !== "rendered") return this.failed("Rendering a document", answer);
    const { html, anchorLines, lineCount } = answer;
    return { html, anchorLines, lineCount };
  }

  /// The document's words and characters, or null when they couldn't be counted.
  async count(text: string): Promise<DocumentCounts | null> {
    const answer = await this.request({ type: "count", text });
    if (answer.type !== "counted") return this.failed("Counting a document", answer);
    const { words, characters } = answer;
    return { words, characters };
  }

  private request(message: WithoutId<ToWorker>): Promise<FromWorker> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.worker.postMessage({ ...message, id });
    });
  }

  private failed(what: string, answer: FromWorker): null {
    if (answer.type === "failed") void this.lauda.invoke("app:log-failure", what, answer.kind);
    return null;
  }
}
