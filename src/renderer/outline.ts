import { outlineItems } from "../shared/markdown";
import type { WindowContext } from "./context";
import { element } from "./dom";
import type { Workspace } from "./workspace";

/// The toolbar's outline popover: the document's headings, indented by
/// level; picking one takes both panes, and the caret, to it (Outline.swift).
/// It is the browser's own popover: the button opens and closes it, the
/// stylesheet anchors it under the button, and a click elsewhere or Escape
/// closes it.
export class OutlinePopover {
  private readonly popover = element("div", "popover");

  constructor(
    private readonly context: WindowContext,
    button: HTMLButtonElement,
    private readonly workspace: Workspace,
  ) {
    this.popover.popover = "auto";
    this.popover.setAttribute("role", "dialog");
    this.popover.setAttribute("aria-label", context.t("Outline"));
    button.popoverTargetElement = this.popover;
    document.body.append(this.popover);
    this.popover.addEventListener("beforetoggle", (event) => {
      if (event.newState === "open" && !this.fill()) event.preventDefault();
    });
    this.popover.addEventListener("toggle", (event) => {
      if (event.newState !== "open") return;
      this.popover.querySelector<HTMLElement>(".outline-row")?.focus({ preventScroll: true });
    });
    // As the native popover does, it goes when the window does.
    window.addEventListener("blur", () => this.close());
  }

  private close(): void {
    if (this.popover.matches(":popover-open")) this.popover.hidePopover();
  }

  /// The selected document's headings as they are when the popover opens;
  /// nothing opens without a document.
  private fill(): boolean {
    const selected = this.workspace.selected;
    if (!selected) return false;
    const items = outlineItems(selected.text);
    if (items.length === 0) {
      this.popover.replaceChildren(element("div", "outline-empty", this.context.t("No headings in the document")));
      return true;
    }
    const list = element("div", "outline-list");
    const minLevel = Math.min(...items.map((item) => item.level));
    for (const item of items) {
      const row = element("button", `outline-row level-${item.level}`, item.title);
      row.title = item.title;
      row.style.paddingLeft = `${10 + (item.level - minLevel) * 14}px`;
      row.addEventListener("click", () => {
        this.close();
        this.workspace.view(selected)?.jumpToLine(item.line);
      });
      list.append(row);
    }
    this.popover.replaceChildren(list);
    return true;
  }
}
