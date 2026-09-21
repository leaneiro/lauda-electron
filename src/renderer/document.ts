import type { WindowContext } from "./context";
import { type ScrollSync, startingScroll } from "./scroll-sync";

type Listener = () => void;

/// How long the text rests before it is written, as the native app writes
/// soon after you stop typing. Leaving the window or closing writes at once.
const autosaveDelay = 2000;

/// A Markdown file, or a new document that has none yet: its text, what was
/// last written and when, and the file it lives in. What NSDocument keeps
/// for the native app, autosave in place included.
export class LaudaDocument {
  readonly id = crypto.randomUUID();
  filePath: string | null;
  text: string;
  /// The text the file held when it was last read or written, and when
  /// that was: what the status bar reads to say "Saved".
  savedText: string | null;
  savedDate: Date | null = null;
  /// What Revert to Saved brings back: the text as it was opened, or as it
  /// was last saved with Save.
  revertText: string | null;
  /// A document without a file compares with the text it was made with (the
  /// welcome guide's), so opening and closing it asks nothing; one made as
  /// the reader's own change, a duplicate, is edited from the start.
  private readonly baseline: string;
  private readonly startsEdited: boolean;
  private untitledTitle: string;
  scrollSync: ScrollSync = startingScroll();

  private readonly listeners = new Set<Listener>();
  private autosaveTimer: number | undefined;
  private writing: Promise<void> = Promise.resolve();
  /// Set while the reader chooses between their text and a file another
  /// app changed: nothing is written until they have.
  private writesAreHeld = false;

  constructor(
    private readonly context: WindowContext,
    options: { filePath: string | null; text: string; title: string; edited?: boolean },
  ) {
    this.filePath = options.filePath;
    this.text = options.text;
    this.savedText = options.filePath ? options.text : null;
    this.revertText = this.savedText;
    this.baseline = options.text;
    this.startsEdited = options.edited ?? false;
    this.untitledTitle = options.title;
  }

  get title(): string {
    if (!this.filePath) return this.untitledTitle;
    return this.filePath.split(/[\\/]/).pop() ?? this.filePath;
  }

  get folder(): string | null {
    if (!this.filePath) return null;
    return this.filePath.replace(/[\\/][^\\/]*$/, "");
  }

  /// Whether closing could lose something: text not yet written to its
  /// file, or a new document changed since it was made.
  get isEdited(): boolean {
    if (this.filePath) return this.text !== this.savedText;
    return this.startsEdited || this.text !== this.baseline;
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyChanged(): void {
    for (const listener of this.listeners) listener();
  }

  /// What typing does: the text changes and the autosave is scheduled.
  edit(text: string): void {
    if (text === this.text) return;
    this.text = text;
    this.notifyChanged();
    this.scheduleAutosave();
  }

  /// Text that came from outside the editor (a revert, another program).
  replaceText(text: string, saved: boolean): void {
    this.text = text;
    if (saved) {
      this.savedText = text;
      this.savedDate = new Date();
    }
    this.notifyChanged();
  }

  private scheduleAutosave(): void {
    if (!this.filePath || this.writesAreHeld) return;
    window.clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => void this.autosave(), autosaveDelay);
  }

  /// Writes the file if its text changed; used on a timer, when the window
  /// loses focus and before closing.
  async autosave(): Promise<boolean> {
    window.clearTimeout(this.autosaveTimer);
    if (this.writesAreHeld) return false;
    if (!this.filePath || this.text === this.savedText) return true;
    return this.write(this.filePath);
  }

  /// ⌘S: a document with a file writes it now; a new one asks where.
  async save(): Promise<boolean> {
    if (!this.filePath) return this.saveAs();
    const ok = await this.autosave();
    if (ok) {
      this.revertText = this.text;
      this.savedDate = new Date();
      this.notifyChanged();
    }
    return ok;
  }

  async saveAs(): Promise<boolean> {
    const path = await this.context.lauda.invoke("doc:save-as", {
      title: this.title,
      text: this.text,
      directory: this.folder,
    });
    if (!path) return false;
    this.filePath = path;
    this.savedText = this.text;
    this.revertText = this.text;
    this.savedDate = new Date();
    this.notifyChanged();
    return true;
  }

  /// Writes one text at a time, taken once, so an edit arriving mid-write
  /// isn't recorded as saved.
  private write(filePath: string): Promise<boolean> {
    const written = this.text;
    const result = this.writing.then(async () => {
      const { lauda, t } = this.context;
      const outcome = await lauda.invoke("doc:write", filePath, written);
      if (!outcome.ok) {
        await lauda.invoke("doc:show-error", t("Couldn't save “%@”", this.title), outcome.error ?? "");
        return false;
      }
      if (this.filePath === filePath) {
        this.savedText = written;
        this.savedDate = new Date();
        this.notifyChanged();
      }
      return true;
    });
    this.writing = result.then(() => undefined);
    return result;
  }

  /// Holds every write, the autosave's included, until `releaseWrites`.
  holdWrites(): void {
    this.writesAreHeld = true;
    window.clearTimeout(this.autosaveTimer);
  }

  releaseWrites(): void {
    this.writesAreHeld = false;
  }

  /// The file moved (Rename, Move To): the document follows it.
  moved(to: string): void {
    this.filePath = to;
    this.notifyChanged();
  }
}
