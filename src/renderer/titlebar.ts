import { isMac, lauda, t } from "./api";
import { icons, widthLevelIcon } from "./icons";
import { OutlinePopover } from "./outline";
import { tabAnimation, type Workspace } from "./workspace";
import type { LaudaDocument } from "./document";
import { previewWidths, type ViewMode } from "../shared/settings";

const modes: { mode: ViewMode; key: string; icon: string }[] = [
  { mode: "editorOnly", key: "Editor Only", icon: icons.editorOnly },
  { mode: "split", key: "Editor and Preview", icon: icons.split },
  { mode: "previewOnly", key: "Preview Only", icon: icons.previewOnly },
];

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

/// The title bar: the document's name, or the open documents as tabs, and
/// the toolbar's glass controls (DocumentToolbar.swift, WorkspaceTabStrip.swift).
export class TitleBar {
  private readonly title = element("div", "window-title");
  private readonly strip = element("div", "tab-strip");
  private readonly spacer = element("div", "title-spacer");
  private readonly center = element("div", "toolbar-center");
  private readonly right = element("div", "toolbar-right");
  private readonly viewModes = element("div", "view-modes glass");
  private readonly widthButton = element("button", "glass-button glass width-button is-out");
  private readonly outlineButton = element("button", "glass-button glass");
  private readonly tabs = new Map<string, HTMLElement>();
  private readonly outline: OutlinePopover;

  constructor(private readonly root: HTMLElement, private readonly workspace: Workspace) {
    if (!isMac()) {
      const menu = element("button", "menu-button");
      menu.innerHTML = icons.menu;
      menu.title = t("Menu");
      menu.setAttribute("aria-label", t("Menu"));
      menu.addEventListener("click", () => {
        const rect = menu.getBoundingClientRect();
        void lauda.invoke("window:show-menu", rect.left, rect.bottom + 4);
      });
      root.append(menu);
    }

    for (const { mode, key, icon } of modes) {
      const button = element("button");
      button.dataset.mode = mode;
      button.innerHTML = icon;
      button.title = t(key);
      button.setAttribute("aria-label", t(key));
      button.addEventListener("click", () => workspace.setViewMode(mode));
      this.viewModes.append(button);
    }
    this.viewModes.setAttribute("role", "group");
    this.viewModes.setAttribute("aria-label", t("View Mode"));

    this.widthButton.innerHTML = widthLevelIcon(0);
    this.widthButton.addEventListener("click", () => workspace.cycleWidth());

    this.outlineButton.innerHTML = icons.outline;
    this.outlineButton.title = t("Document outline");
    this.outlineButton.setAttribute("aria-label", t("Outline"));
    this.outline = new OutlinePopover(this.outlineButton, workspace);
    this.outlineButton.addEventListener("click", () => this.outline.toggle());

    root.append(this.title, this.strip, this.spacer, this.center, this.right);
    this.right.append(this.widthButton, this.outlineButton);

    // The glass answers the pointer with a light that follows it.
    root.addEventListener("pointermove", (event) => {
      const glass = (event.target as HTMLElement).closest<HTMLElement>(".glass");
      if (!glass) return;
      const rect = glass.getBoundingClientRect();
      glass.style.setProperty("--pointer-x", `${event.clientX - rect.left}px`);
      glass.style.setProperty("--pointer-y", `${event.clientY - rect.top}px`);
    });

    if (isMac()) {
      root.addEventListener("dblclick", (event) => {
        if (event.target === root || event.target === this.spacer || event.target === this.title || event.target === this.strip) {
          void lauda.invoke("window:title-bar-double-click");
        }
      });
    }
    this.watchWindowControls();
    workspace.onChange(() => this.render());
    this.render();
  }

  render(): void {
    const workspace = this.workspace;
    const selected = workspace.selected;

    this.title.textContent = selected?.title ?? "";
    this.title.title = selected?.filePath ?? selected?.title ?? "";
    this.title.classList.toggle("is-hidden", workspace.showsTabs);
    this.title.hidden = workspace.showsTabs;
    this.strip.hidden = !workspace.showsTabs;
    this.strip.classList.toggle("is-out", !workspace.tabsAreIn);
    this.renderTabs();

    // One document keeps the picker in the middle of the bar; with tabs it
    // joins the controls on the right.
    const pickerParent = workspace.showsTabs ? this.right : this.center;
    if (this.viewModes.parentElement !== pickerParent) {
      if (workspace.showsTabs) this.right.prepend(this.viewModes);
      else this.center.append(this.viewModes);
    }
    for (const button of this.viewModes.querySelectorAll<HTMLButtonElement>("button")) {
      button.setAttribute("aria-pressed", String(button.dataset.mode === workspace.viewMode));
    }

    const width = workspace.previewWidth;
    const next = previewWidths[(width.level + 1) % previewWidths.length];
    const isShown = workspace.viewMode === "previewOnly";
    this.widthButton.classList.toggle("is-out", !isShown);
    this.widthButton.setAttribute("aria-hidden", String(!isShown));
    this.widthButton.tabIndex = isShown ? 0 : -1;
    this.widthButton.title = t("Text width: %@. Next: %@", t(width.key), t(next.key));
    this.widthButton.setAttribute("aria-label", t("Text width: %@", t(width.key)));
    const column = this.widthButton.querySelector<SVGRectElement>(".width-column");
    if (column) {
      const size = [6, 10, 14][width.level] ?? 6;
      column.style.width = `${size}px`;
      column.style.x = `${11 - size / 2}px`;
    }
  }

  private renderTabs(): void {
    // A lone document has a title, not a tab: on the way from two documents
    // to one both tabs go, and the title bar changes once they have.
    const documents = this.workspace.documents.length >= 2 ? this.workspace.documents : [];
    const present = new Set<string>(documents.map((d) => d.id));

    for (const [id, tab] of this.tabs) {
      if (present.has(id) || tab.classList.contains("is-leaving") || tab.classList.contains("is-fading")) continue;
      // A tab closed with others still open leaves its room to them; the last
      // two go together, and fade where they stand as the strip goes with them.
      tab.classList.add(documents.length === 0 ? "is-fading" : "is-leaving");
      window.setTimeout(() => tab.remove(), tabAnimation);
      this.tabs.delete(id);
    }

    let previous: HTMLElement | null = null;
    for (const document of documents) {
      let tab = this.tabs.get(document.id);
      if (!tab) {
        tab = this.makeTab(document);
        this.tabs.set(document.id, tab);
        if (this.workspace.tabsAreIn) {
          tab.classList.add("is-entering");
          const entering = tab;
          requestAnimationFrame(() => requestAnimationFrame(() => entering.classList.remove("is-entering")));
        }
      }
      this.updateTab(tab, document);
      const expected: Element | null = previous ? previous.nextElementSibling : this.strip.firstElementChild;
      if (expected !== tab) {
        if (previous) previous.after(tab);
        else this.strip.prepend(tab);
      }
      previous = tab;
    }
  }

  private makeTab(document: LaudaDocument): HTMLElement {
    const tab = element("div", "tab glass");
    const close = element("button", "tab-close");
    close.innerHTML = `<span class="icon-x">${icons.close}</span><span class="icon-dot">${icons.dot}</span>`;
    const title = element("span", "tab-title");
    tab.append(close, title);
    tab.addEventListener("click", () => this.workspace.select(document));
    // The wheel closes the tab it is clicked on, wherever on it.
    tab.addEventListener("mousedown", (event) => {
      if (event.button === 1) event.preventDefault();
    });
    tab.addEventListener("auxclick", (event) => {
      if (event.button !== 1) return;
      event.preventDefault();
      void this.workspace.close(document);
    });
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      void this.workspace.close(document);
    });
    return tab;
  }

  private updateTab(tab: HTMLElement, document: LaudaDocument): void {
    const isSelected = document === this.workspace.selected;
    tab.classList.toggle("is-selected", isSelected);
    tab.classList.toggle("clear", !isSelected);
    tab.classList.toggle("is-edited", document.isEdited);
    tab.title = document.filePath ?? document.title;
    const title = tab.querySelector(".tab-title");
    if (title && title.textContent !== document.title) title.textContent = document.title;
    const close = tab.querySelector<HTMLElement>(".tab-close");
    close?.setAttribute(
      "aria-label",
      document.isEdited ? t("Close %@, unsaved", document.title) : t("Close %@", document.title),
    );
  }

  /// Windows and Linux draw the window's buttons over the right end of the
  /// title bar; the controls stop short of them.
  private watchWindowControls(): void {
    const overlay = (navigator as Navigator & { windowControlsOverlay?: { visible: boolean; getTitlebarAreaRect(): DOMRect; addEventListener(type: string, listener: () => void): void } }).windowControlsOverlay;
    if (!overlay || isMac()) return;
    // Until the system reports where its buttons are, the room measured for
    // them on each system (set at startup) stands.
    const update = () => {
      const rect = overlay.getTitlebarAreaRect();
      if (!overlay.visible || rect.width <= 0) return;
      const room = Math.max(window.innerWidth - (rect.x + rect.width), 0);
      document.documentElement.style.setProperty("--window-controls-room", `${room}px`);
    };
    overlay.addEventListener("geometrychange", update);
    window.addEventListener("resize", update);
    update();
  }
}
