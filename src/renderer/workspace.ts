import { lauda, t } from "./api";
import { LaudaDocument } from "./document";
import { DocumentView } from "./document-view";
import type { MenuCommand, OpenDocument } from "../shared/ipc";
import { nextPreviewWidthLevel, previewWidthShowing, type Settings, type ViewMode } from "../shared/settings";

type Listener = () => void;

/// How long a tab takes to come or go, which the title bar waits for.
export const tabAnimation = 200;
/// How long the title bar takes to change its layout before the tabs show.
const titleBarSettling = 120;

/// The window's documents and the tabs they show as (Workspace.swift): each
/// document keeps panes of its own, and selecting a tab brings its panes
/// forward, which is why switching is instant.
export class Workspace {
  documents: LaudaDocument[] = [];
  selected: LaudaDocument | null = null;
  viewMode: ViewMode;
  settings: Settings;
  /// Whether the title bar is laid out for tabs, and whether they have come
  /// into view: with the second document the layout changes at once and the
  /// tabs fade in a moment later; back to one, they fade out first.
  showsTabs = false;
  tabsAreIn = false;
  /// Off while the app quits: documents closing then are not the reader
  /// closing tabs, and the next launch should bring them back.
  private remembersSession = true;

  private readonly views = new Map<string, DocumentView>();
  private readonly listeners = new Set<Listener>();
  private readonly container: HTMLElement;
  private sessionTimer: number | undefined;

  constructor(container: HTMLElement, settings: Settings) {
    this.container = container;
    this.settings = settings;
    this.viewMode = settings.lastViewMode;
  }

  onChange(listener: Listener): void {
    this.listeners.add(listener);
  }

  changed(): void {
    for (const listener of this.listeners) listener();
    this.reportToMain();
  }

  view(document: LaudaDocument): DocumentView | undefined {
    return this.views.get(document.id);
  }

  get previewWidth() {
    return previewWidthShowing(this.settings.previewWidthLevel, this.viewMode);
  }

  // MARK: - Tabs

  open(request: OpenDocument): void {
    if (request.filePath) {
      const existing = this.documents.find((document) => document.filePath === request.filePath);
      if (existing) {
        this.select(existing);
        return;
      }
    }
    const document = new LaudaDocument({
      filePath: request.filePath,
      text: request.text,
      title: request.title ?? this.nextUntitledTitle(),
      edited: request.edited,
    });
    this.add(document);
  }

  newDocument(): void {
    this.add(new LaudaDocument({ filePath: null, text: "", title: this.nextUntitledTitle() }));
  }

  /// "Untitled", then "Untitled 2" and on, as a document app names them.
  private nextUntitledTitle(): string {
    const base = t("Untitled");
    const taken = new Set(this.documents.filter((d) => !d.filePath).map((d) => d.title));
    if (!taken.has(base)) return base;
    for (let number = 2; ; number++) {
      const title = `${base} ${number}`;
      if (!taken.has(title)) return title;
    }
  }

  add(document: LaudaDocument): void {
    this.documents.push(document);
    const view = new DocumentView(document, this);
    this.views.set(document.id, view);
    this.container.append(view.element);
    document.onChange(() => this.changed());
    if (document.filePath) void lauda.invoke("doc:watch", document.filePath);
    this.tabsChanged();
    this.select(document);
  }

  select(document: LaudaDocument): void {
    if (!this.documents.includes(document)) return;
    const previous = this.selected;
    this.selected = document;
    for (const [id, view] of this.views) view.setVisible(id === document.id);
    if (previous !== document) this.views.get(document.id)?.focus();
    this.changed();
  }

  selectNext(): void {
    this.step(1);
  }

  selectPrevious(): void {
    this.step(-1);
  }

  private step(offset: number): void {
    if (!this.selected || this.documents.length < 2) return;
    const index = this.documents.indexOf(this.selected);
    const count = this.documents.length;
    this.select(this.documents[(index + offset + count) % count]);
  }

  /// Closes a tab, letting the document have its say first: a file is
  /// written, and a new document with text in it asks whether to keep it.
  async close(document: LaudaDocument): Promise<boolean> {
    if (!this.documents.includes(document)) return true;
    if (!(await this.canClose(document))) return false;
    this.remove(document);
    return true;
  }

  private async canClose(document: LaudaDocument): Promise<boolean> {
    if (document.filePath) return document.autosave();
    if (!document.isEdited) return true;
    // Whether to keep the text is asked with its tab in front.
    this.select(document);
    const answer = await lauda.invoke("doc:ask-save-changes", document.title);
    if (answer === "cancel") return false;
    if (answer === "dontSave") return true;
    return document.saveAs();
  }

  private remove(document: LaudaDocument): void {
    const index = this.documents.indexOf(document);
    if (index < 0) return;
    this.documents.splice(index, 1);
    this.views.get(document.id)?.destroy();
    this.views.delete(document.id);
    if (document.filePath) void lauda.invoke("doc:unwatch", document.filePath);
    if (this.selected === document) {
      this.selected = this.documents[Math.min(index, this.documents.length - 1)] ?? null;
      if (this.selected) this.select(this.selected);
    }
    this.tabsChanged();
    this.changed();
  }

  /// The window is closing, or the app quits: every document in turn. On
  /// quit the tabs stay in the session, so they come back next time.
  async closeEverything(reason: "window" | "quit"): Promise<boolean> {
    if (reason === "quit") this.remembersSession = false;
    for (const document of [...this.documents]) {
      const ok = reason === "quit" ? await this.canClose(document) : await this.close(document);
      if (!ok) {
        this.remembersSession = true;
        this.changed();
        return false;
      }
    }
    return true;
  }

  /// The title bar's layout follows the number of documents; on the way
  /// back to one, it waits for the tabs to fade out.
  private tabsChanged(): void {
    const wantsTabs = this.documents.length >= 2;
    if (wantsTabs === this.showsTabs) return;
    const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      this.showsTabs = wantsTabs;
      this.tabsAreIn = wantsTabs;
    } else if (wantsTabs) {
      this.showsTabs = true;
      window.setTimeout(() => {
        if (!this.showsTabs) return;
        this.tabsAreIn = true;
        this.changed();
      }, titleBarSettling);
    } else {
      this.tabsAreIn = false;
      window.setTimeout(() => {
        if (this.documents.length >= 2) return;
        this.showsTabs = false;
        this.changed();
      }, tabAnimation);
    }
  }

  // MARK: - View mode and settings

  setViewMode(mode: ViewMode): void {
    if (mode === this.viewMode) return;
    this.viewMode = mode;
    void lauda.invoke("settings:set", { lastViewMode: mode });
    for (const [id, view] of this.views) {
      view.setViewMode(mode, id === this.selected?.id);
    }
    this.selected && this.views.get(this.selected.id)?.focus();
    this.changed();
  }

  cycleWidth(): void {
    const level = nextPreviewWidthLevel(this.previewWidth.level);
    void lauda.invoke("settings:set", { previewWidthLevel: level });
  }

  setSplitFraction(fraction: number): void {
    this.settings = { ...this.settings, splitFraction: fraction };
    for (const view of this.views.values()) view.setSplit(fraction);
  }

  storeSplitFraction(): void {
    void lauda.invoke("settings:set", { splitFraction: this.settings.splitFraction });
  }

  applySettings(settings: Settings): void {
    this.settings = settings;
    for (const view of this.views.values()) view.applySettings(settings);
    this.changed();
  }

  // MARK: - Commands

  async perform(command: MenuCommand): Promise<void> {
    const document = this.selected;
    const view = document ? this.views.get(document.id) : undefined;
    switch (command.name) {
      case "new":
        this.newDocument();
        return;
      case "view-mode":
        this.setViewMode(command.mode);
        return;
      case "next-tab":
        this.selectNext();
        return;
      case "previous-tab":
        this.selectPrevious();
        return;
    }
    if (!document || !view) return;
    switch (command.name) {
      case "close":
        await this.close(document);
        return;
      case "save":
        await document.save();
        return;
      case "duplicate":
        this.open({ filePath: null, text: document.text, title: t("%@ copy", document.title.replace(/\.[^.]+$/, "")), edited: true });
        return;
      case "rename":
      case "move": {
        if (!document.filePath) return;
        await document.autosave();
        const from = document.filePath;
        const to = await lauda.invoke(command.name === "rename" ? "doc:rename" : "doc:move", from);
        if (!to) return;
        void lauda.invoke("doc:unwatch", from);
        document.moved(to);
        void lauda.invoke("doc:watch", to);
        view.fileMoved();
        return;
      }
      case "revert":
        if (document.revertText === null || document.revertText === document.text) return;
        if (!(await lauda.invoke("doc:ask-revert", document.title))) return;
        view.replaceText(document.revertText);
        await document.autosave();
        return;
      case "export-pdf":
      case "export-html":
        await lauda.invoke(command.name === "export-pdf" ? "export:pdf" : "export:html", {
          title: document.title.replace(/\.[^.]+$/, ""),
          markdown: document.text,
          filePath: document.filePath,
        });
        return;
      default:
        view.perform(command);
    }
  }

  /// Another program changed an open file. Unless the reader has changes
  /// of their own waiting to be written, the tab shows the new text.
  fileChangedOnDisk(filePath: string, text: string): void {
    const document = this.documents.find((d) => d.filePath === filePath);
    if (!document || document.isEdited || document.text === text) return;
    this.views.get(document.id)?.replaceText(text, true);
  }

  /// Writes every document with a file; the window lost focus.
  flushAutosaves(): void {
    for (const document of this.documents) void document.autosave();
  }

  // MARK: - What the main process mirrors

  /// What was last sent, so a keystroke that changes none of it sends nothing.
  private reported = { window: "", menu: "", session: "" };

  private reportToMain(): void {
    const document = this.selected;
    const windowInfo = { title: document?.title ?? "Lauda", filePath: document?.filePath ?? null, edited: document?.isEdited ?? false };
    const menu = { hasDocument: !!document, hasFile: !!document?.filePath, documentCount: this.documents.length, viewMode: this.viewMode };
    const session = {
      files: this.documents.flatMap((d) => (d.filePath ? [d.filePath] : [])),
      selected: this.selected?.filePath ?? null,
    };
    const windowKey = JSON.stringify(windowInfo);
    if (windowKey !== this.reported.window) {
      this.reported.window = windowKey;
      void lauda.invoke("window:set-document", windowInfo);
    }
    const menuKey = JSON.stringify(menu);
    if (menuKey !== this.reported.menu) {
      this.reported.menu = menuKey;
      void lauda.invoke("menu:set-state", menu);
    }
    const sessionKey = JSON.stringify(session);
    if (this.remembersSession && sessionKey !== this.reported.session) {
      window.clearTimeout(this.sessionTimer);
      this.sessionTimer = window.setTimeout(() => {
        if (!this.remembersSession) return;
        this.reported.session = sessionKey;
        void lauda.invoke("session:store", session);
      }, 150);
    }
  }
}
