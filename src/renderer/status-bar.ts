import { isMac, shortcut, strings, t } from "./api";
import { icons } from "./icons";
import { characterCount, readingTimeLabel, saveStatusOf, wordCount } from "./document-info";
import type { LaudaDocument } from "./document";

/// Counting walks the whole text; while typing it waits for a pause.
const countingPause = 300;

/// The strip under a document: word and character counts, reading time and
/// whether the document is saved (StatusBar.swift).
export class StatusBar {
  readonly element = document.createElement("footer");
  private readonly words = document.createElement("span");
  private readonly characters = document.createElement("span");
  private readonly reading = document.createElement("span");
  private readonly save = document.createElement("span");
  private countTimer: number | undefined;
  private counted: number | null = null;
  private readonly unsubscribe: () => void;
  private readonly clock: number;

  constructor(private readonly document: LaudaDocument) {
    this.element.className = "status-bar";
    const spacer = window.document.createElement("span");
    spacer.className = "spacer";
    this.save.className = "save-status";
    this.save.title = isMac() ? t("macOS saves automatically; ⌘S saves right away.") : t("Lauda saves automatically; %@ saves right away.", shortcut("S"));
    this.element.append(this.words, this.characters, this.reading, spacer, this.save);
    this.unsubscribe = document.onChange(() => this.update(false));
    // "Saved · 10:42" names a time, which the clock can make stale only by
    // the minute; the label is read again now and then.
    this.clock = window.setInterval(() => this.renderSave(), 30_000);
    this.update(true);
  }

  private update(immediately: boolean): void {
    this.characters.textContent = t("%lld characters", characterCount(this.document.text));
    this.renderSave();
    window.clearTimeout(this.countTimer);
    const count = () => {
      this.counted = wordCount(this.document.text, strings().locale);
      this.renderWords();
    };
    if (immediately || this.counted === null) count();
    else this.countTimer = window.setTimeout(count, countingPause);
  }

  private renderWords(): void {
    if (this.counted === null) return;
    this.words.textContent = t("%lld words", this.counted);
    const reading = readingTimeLabel(this.counted);
    this.reading.textContent = reading ?? "";
    this.reading.hidden = reading === null;
  }

  private renderSave(): void {
    const status = saveStatusOf(this.document);
    this.save.dataset.status = status.kind;
    const icon = status.kind === "saved" ? icons.saved : status.kind === "editing" ? icons.editing : icons.notSaved;
    this.save.innerHTML = `${icon}<span></span>`;
    (this.save.lastElementChild as HTMLElement).textContent = status.label;
  }

  destroy(): void {
    this.unsubscribe();
    window.clearTimeout(this.countTimer);
    window.clearInterval(this.clock);
  }
}
