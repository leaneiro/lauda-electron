import type { FromPreview, PreviewReplies, ToPreview } from "../../shared/preview-protocol";
import { lauda } from "../api";
import type { LaudaDocument } from "../document";
import type { FindCounts, PreviewFinding } from "../find";
import { differs, endConvergence, type ScrollSync, startingScroll } from "../scroll-sync";

/// A message the pane waits on, as it is written: the id its reply comes
/// back with is added on the way out.
type Request = { [T in keyof PreviewReplies]: Omit<Extract<ToPreview, { type: T }>, "id"> }[keyof PreviewReplies];
type Reply = PreviewReplies[keyof PreviewReplies];

interface RenderedContent {
  html: string;
  anchorLines: number[];
  lineCount: number;
}

/// One worker renders for every document; each request carries an id.
class RenderClient {
  private readonly worker = new Worker("render-worker.js");
  private nextId = 1;
  private readonly waiting = new Map<number, (content: RenderedContent | null) => void>();

  constructor() {
    this.worker.onmessage = (event: MessageEvent<RenderedContent & { id: number; error?: string }>) => {
      const { id, error, ...content } = event.data;
      const resolve = this.waiting.get(id);
      this.waiting.delete(id);
      if (error) void lauda.invoke("app:log-failure", "Rendering a document", error);
      resolve?.(error ? null : content);
    };
  }

  render(markdown: string, strictLineBreaks: boolean): Promise<RenderedContent | null> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.worker.postMessage({ id, markdown, strictLineBreaks });
    });
  }
}

let sharedClient: RenderClient | undefined;
const renderer = () => (sharedClient ??= new RenderClient());

/// The rendered Markdown (PreviewWebView.swift): a page loaded once with the
/// preview's stylesheet, then updated in place (no flicker, the scroll
/// position kept) through messages to its script.
export class PreviewPane implements PreviewFinding {
  private readonly frame = document.createElement("iframe");
  private isReady = false;
  private lastMarkdown: string | null = null;
  private lastStrict = false;
  private needsRender = false;
  private isRendering = false;
  private pendingContent: RenderedContent | null = null;
  private lastStyle: { family: string; size: number; lineHeight: number } | null = null;
  private lastWidth: number | null = null;
  private lastScroll: ScrollSync = startingScroll();
  private pendingScroll: ScrollSync | null = null;
  private nextRequest = 1;
  private readonly waiting = new Map<number, (reply: Reply) => void>();
  private readonly onMessage = (event: MessageEvent<FromPreview>) => this.receive(event);

  constructor(
    host: HTMLElement,
    private readonly document: LaudaDocument,
    private readonly callbacks: { publishScroll: (sync: ScrollSync) => void },
  ) {
    this.frame.className = "preview-frame";
    // Scripts for the preview's own script only: no forms, popups or
    // navigating the window, and an origin of its own.
    this.frame.setAttribute("sandbox", "allow-scripts");
    this.frame.setAttribute("title", document.title);
    host.append(this.frame);
    window.addEventListener("message", this.onMessage);
    void this.load();
  }

  private async load(): Promise<void> {
    const token = await lauda.invoke("doc:register-folder", this.document.id, this.document.filePath);
    this.isReady = false;
    this.frame.src = `lauda-doc://${token}/.lauda-preview`;
  }

  // MARK: - Content

  setMarkdown(markdown: string, strictLineBreaks: boolean): void {
    // Toggling the setting must render again even when the text is unchanged.
    if (markdown === this.lastMarkdown && strictLineBreaks === this.lastStrict) return;
    this.lastMarkdown = markdown;
    this.lastStrict = strictLineBreaks;
    this.needsRender = true;
    this.renderNextIfIdle();
  }

  /// Renders at once, no debounce, but never stacks work: while a render is
  /// in flight, newer text only marks it dirty, and the latest renders as
  /// soon as the current one finishes. A typing burst paces itself to what
  /// the machine sustains.
  private renderNextIfIdle(): void {
    if (!this.needsRender || this.isRendering || this.lastMarkdown === null) return;
    this.needsRender = false;
    this.isRendering = true;
    void renderer()
      .render(this.lastMarkdown, this.lastStrict)
      .then(async (content) => {
        if (content) await this.pushContent(content);
        this.isRendering = false;
        this.renderNextIfIdle();
      });
  }

  private async pushContent(content: RenderedContent): Promise<void> {
    if (!this.isReady) {
      this.pendingContent = content;
      return;
    }
    await this.request({
      type: "setContent",
      html: content.html,
      lines: content.anchorLines,
      lineCount: content.lineCount,
    });
    this.alignScrollAfterContentChange();
  }

  setStyle(family: string, size: number, lineHeight: number): void {
    const style = { family, size, lineHeight };
    if (this.lastStyle && JSON.stringify(this.lastStyle) === JSON.stringify(style)) return;
    this.lastStyle = style;
    if (this.isReady) this.post({ type: "setStyle", ...style });
  }

  /// The column's width in preview-only mode's levels.
  setContentWidth(rem: number): void {
    if (rem === this.lastWidth) return;
    this.lastWidth = rem;
    if (this.isReady) this.post({ type: "setContentWidth", rem });
  }

  /// The pane changed size once a mode change settled: stay on the same line.
  realign(): void {
    if (this.isReady) this.post({ type: "realign" });
  }

  focus(): boolean {
    this.frame.focus();
    if (this.isReady) this.post({ type: "focus" });
    return true;
  }

  /// The document's file moved: relative images now come from its new folder.
  fileMoved(): void {
    this.frame.setAttribute("title", this.document.title);
    void this.load();
  }

  // MARK: - Scroll sync

  syncScroll(sync: ScrollSync): void {
    // Not loaded yet: remember the position and apply it once the content
    // lands, whichever pane scrolled last.
    if (!this.isReady) {
      this.pendingScroll = sync;
      return;
    }
    if (sync.source === "preview") {
      this.lastScroll = sync;
      return;
    }
    if (!differs(sync, this.lastScroll)) return;
    this.lastScroll = sync;
    this.applyScroll(sync);
  }

  /// After each content push: applies a position that arrived before the
  /// page was ready, or re-aligns to the last one, since edits shift where
  /// each source line sits in the preview.
  private alignScrollAfterContentChange(): void {
    if (this.pendingScroll) {
      this.lastScroll = this.pendingScroll;
      this.pendingScroll = null;
    }
    this.applyScroll(this.lastScroll);
  }

  private applyScroll(sync: ScrollSync): void {
    const { line, endLine, fraction, toEndDistance } = sync;
    this.post({
      type: "setScrollPosition",
      position: { line, endLine, fraction, toEndDistance, convergence: endConvergence },
    });
  }

  // MARK: - Find

  async find(query: string, forward: boolean, restart: boolean): Promise<FindCounts> {
    if (!this.isReady) return { current: 0, total: 0 };
    const { current, total } = await this.request({ type: "find", query, forward, restart });
    return { current, total };
  }

  clearFind(): void {
    if (this.isReady) this.post({ type: "findClear" });
  }

  // MARK: - Messages

  private post(message: ToPreview): void {
    this.frame.contentWindow?.postMessage(message, "*");
  }

  /// Posts a message the page answers, and resolves with the answer.
  private request<R extends Request>(message: R): Promise<PreviewReplies[R["type"]]> {
    const id = this.nextRequest++;
    return new Promise((resolve) => {
      // The page answers each request with the reply of its kind.
      this.waiting.set(id, (reply) => resolve(reply as PreviewReplies[R["type"]]));
      this.post({ ...message, id });
    });
  }

  private receive(event: MessageEvent<FromPreview>): void {
    if (event.source !== this.frame.contentWindow) return;
    const message = event.data;
    switch (message.type) {
      case "ready":
        this.isReady = true;
        if (this.lastStyle) this.post({ type: "setStyle", ...this.lastStyle });
        if (this.lastWidth !== null) this.post({ type: "setContentWidth", rem: this.lastWidth });
        if (this.pendingContent) {
          const content = this.pendingContent;
          this.pendingContent = null;
          void this.pushContent(content);
        } else if (this.lastMarkdown !== null && !this.isRendering) {
          this.needsRender = true;
          this.renderNextIfIdle();
        }
        break;
      case "contentApplied":
      case "findResult":
        this.waiting.get(message.id)?.(message);
        this.waiting.delete(message.id);
        break;
      case "previewScrolled": {
        const { line, endLine, fraction, toEndDistance } = message;
        const sync: ScrollSync = { line, endLine, fraction, toEndDistance, source: "preview" };
        this.lastScroll = sync;
        this.callbacks.publishScroll(sync);
        break;
      }
      case "openLink":
        void lauda.invoke("app:open-external", message.href);
        break;
    }
  }

  destroy(): void {
    window.removeEventListener("message", this.onMessage);
    void lauda.invoke("doc:forget-folder", this.document.id);
    this.frame.remove();
  }
}
