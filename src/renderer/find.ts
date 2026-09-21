import type { ViewMode } from "../shared/settings";
import type { WindowContext } from "./context";
import { icons } from "./icons";

export interface FindCounts {
  current: number;
  total: number;
}

/// What the find bar needs from the editor pane.
export interface EditorFinding {
  findUpdate(query: string): FindCounts;
  findStep(forward: boolean): FindCounts;
  findClear(): void;
  showReplace(): void;
  /// Receives new counts later, when edits change the matches.
  setFindCountsHandler(handler: ((counts: FindCounts) => void) | null): void;
  focus(): boolean;
}

/// What the find bar needs from the preview pane.
export interface PreviewFinding {
  find(query: string, forward: boolean, restart: boolean): Promise<FindCounts>;
  clearFind(): void;
}

/// A document's floating find bar: its query, the match counts and which
/// pane answers (FindSession.swift). The editor searches whenever it's
/// visible; in preview-only mode the preview does.
export class FindSession {
  private readonly bar = document.createElement("div");
  private readonly input = document.createElement("input");
  private readonly count = document.createElement("span");
  private readonly previous = document.createElement("button");
  private readonly next = document.createElement("button");
  private isPresented = false;
  private current = 0;
  private total = 0;

  constructor(
    context: WindowContext,
    host: HTMLElement,
    private readonly editor: EditorFinding,
    private readonly preview: PreviewFinding,
    private readonly mode: () => ViewMode,
  ) {
    const { t } = context;
    this.bar.className = "find-bar";
    this.bar.hidden = true;
    const magnifier = document.createElement("span");
    magnifier.innerHTML = icons.magnifier;
    magnifier.style.display = "grid";
    this.input.type = "text";
    this.input.placeholder = t("Find");
    this.input.spellcheck = false;
    this.input.setAttribute("aria-label", t("Find"));
    this.count.className = "find-count";
    this.previous.innerHTML = icons.chevronLeft;
    this.next.innerHTML = icons.chevronRight;
    this.previous.title = context.isMac ? t("Previous (⇧⌘G)") : t("Previous (%@)", context.shortcut("G", true));
    this.next.title = context.isMac ? t("Next (⌘G)") : t("Next (%@)", context.shortcut("G"));
    this.previous.setAttribute("aria-label", this.previous.title);
    this.next.setAttribute("aria-label", this.next.title);
    const close = document.createElement("button");
    close.className = "find-close";
    close.innerHTML = icons.clearField;
    close.title = t("Close (Esc)");
    close.setAttribute("aria-label", close.title);
    this.bar.append(magnifier, this.input, this.count, this.previous, this.next, close);
    host.append(this.bar);

    this.input.addEventListener("input", () => this.search());
    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.step(!event.shiftKey);
      } else if (event.key === "Escape") {
        event.preventDefault();
        this.close();
      }
    });
    this.previous.addEventListener("click", () => this.step(false));
    this.next.addEventListener("click", () => this.step(true));
    close.addEventListener("click", () => this.close());
    this.render();
  }

  /// Shows the bar, searching again for a query that's already typed.
  open(): void {
    this.isPresented = true;
    this.bar.hidden = false;
    this.editor.setFindCountsHandler((counts) => this.show(counts));
    this.input.focus();
    this.input.select();
    if (this.input.value) this.search();
    this.render();
  }

  /// Searches for the query from the top of the document.
  search(): void {
    if (!this.isPresented) return;
    const query = this.input.value;
    if (!query) {
      this.show({ current: 0, total: 0 });
      this.editor.findClear();
      this.preview.clearFind();
      return;
    }
    if (this.mode() === "previewOnly") {
      void this.preview.find(query, true, true).then((counts) => this.show(counts));
    } else {
      this.show(this.editor.findUpdate(query));
    }
  }

  /// The next or previous match; opens the bar when there's nothing to step through.
  step(forward: boolean): void {
    if (!this.isPresented || !this.input.value) {
      this.open();
      return;
    }
    if (this.mode() === "previewOnly") {
      void this.preview.find(this.input.value, forward, false).then((counts) => this.show(counts));
    } else {
      this.show(this.editor.findStep(forward));
    }
  }

  /// The editor's own find-and-replace. The preview can't replace, so in
  /// preview-only mode this opens the find bar instead.
  replace(): void {
    if (this.mode() === "previewOnly") {
      this.open();
    } else {
      this.close();
      this.editor.showReplace();
    }
  }

  close(): void {
    const hadFocus = this.bar.contains(document.activeElement);
    this.isPresented = false;
    this.bar.hidden = true;
    this.editor.setFindCountsHandler(null);
    this.show({ current: 0, total: 0 });
    this.editor.findClear();
    this.preview.clearFind();
    if (hadFocus && this.mode() !== "previewOnly") this.editor.focus();
  }

  /// The panes change with the mode, so an open search starts over in them.
  modeChanged(_mode: ViewMode): void {
    if (!this.isPresented) return;
    this.editor.findClear();
    this.preview.clearFind();
    queueMicrotask(() => this.search());
  }

  private show(counts: FindCounts): void {
    this.current = counts.current;
    this.total = counts.total;
    this.render();
  }

  private render(): void {
    const hasQuery = this.input.value.length > 0;
    this.count.hidden = !hasQuery;
    this.count.textContent = this.total > 0 ? `${this.current}/${this.total}` : "0";
    this.count.classList.toggle("is-empty", this.total === 0);
    this.previous.disabled = this.total === 0;
    this.next.disabled = this.total === 0;
  }
}
