import { t } from "./api";
import { outlineItems } from "./document-info";
import type { Workspace } from "./workspace";

/// The toolbar's outline popover: the document's headings, indented by
/// level; picking one takes both panes, and the caret, to it (Outline.swift).
export class OutlinePopover {
  private popover: HTMLElement | null = null;
  private readonly dismiss = (event: Event) => {
    if (event instanceof KeyboardEvent && event.key !== "Escape") return;
    if (
      event instanceof MouseEvent &&
      (this.popover?.contains(event.target as Node) || this.anchor.contains(event.target as Node))
    )
      return;
    this.close();
  };

  constructor(
    private readonly anchor: HTMLElement,
    private readonly workspace: Workspace,
  ) {}

  toggle(): void {
    if (this.popover) this.close();
    else this.open();
  }

  private open(): void {
    const document = this.workspace.selected;
    if (!document) return;
    const items = outlineItems(document.text);
    const popover = window.document.createElement("div");
    popover.className = "popover";
    popover.setAttribute("role", "dialog");
    popover.setAttribute("aria-label", t("Outline"));

    if (items.length === 0) {
      const empty = window.document.createElement("div");
      empty.className = "outline-empty";
      empty.textContent = t("No headings in the document");
      popover.append(empty);
    } else {
      const list = window.document.createElement("div");
      list.className = "outline-list";
      const minLevel = Math.min(...items.map((item) => item.level));
      for (const item of items) {
        const row = window.document.createElement("button");
        row.className = `outline-row level-${item.level}`;
        row.textContent = item.title;
        row.title = item.title;
        row.style.paddingLeft = `${10 + (item.level - minLevel) * 14}px`;
        row.addEventListener("click", () => {
          this.close();
          this.workspace.view(document)?.jumpToLine(item.line);
        });
        list.append(row);
      }
      popover.append(list);
    }

    window.document.body.append(popover);
    const anchor = this.anchor.getBoundingClientRect();
    const width = popover.offsetWidth;
    const left = Math.min(Math.max(anchor.left + anchor.width / 2 - width + 20, 8), window.innerWidth - width - 8);
    popover.style.left = `${left}px`;
    popover.style.top = `${anchor.bottom + 10}px`;
    popover.style.setProperty(
      "--arrow-right",
      `${Math.max(left + width - (anchor.left + anchor.width / 2) - 6, 14)}px`,
    );
    this.popover = popover;
    popover.querySelector<HTMLElement>(".outline-row")?.focus({ preventScroll: true });
    setTimeout(() => {
      window.addEventListener("mousedown", this.dismiss, true);
      window.addEventListener("keydown", this.dismiss, true);
      window.addEventListener("blur", this.dismiss);
    });
  }

  close(): void {
    this.popover?.remove();
    this.popover = null;
    window.removeEventListener("mousedown", this.dismiss, true);
    window.removeEventListener("keydown", this.dismiss, true);
    window.removeEventListener("blur", this.dismiss);
  }
}
