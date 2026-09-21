import { type SaveStatusIcon, saveStatusColor, saveStatusIcon } from "../shared/document";
import type { WindowContext } from "./context";
import { CountsModel } from "./counts";
import type { LaudaDocument } from "./document";
import { readingTimeLabel, saveStatusOf } from "./document-info";
import { icons } from "./icons";

/// The native app's symbols for a save status, drawn here as their SVGs.
const drawnIcons: Record<SaveStatusIcon, string> = {
  "circle.dotted": icons.notSaved,
  "checkmark.circle.fill": icons.saved,
  "ellipsis.circle.fill": icons.editing,
};

/// The strip under a document: word and character counts, reading time and
/// whether the document is saved (StatusBar.swift).
export class StatusBar {
  readonly element = document.createElement("footer");
  private readonly words = document.createElement("span");
  private readonly characters = document.createElement("span");
  private readonly reading = document.createElement("span");
  private readonly save = document.createElement("span");
  private readonly counts: CountsModel;
  private readonly unsubscribe: () => void;
  private readonly clock: number;

  constructor(
    private readonly context: WindowContext,
    private readonly document: LaudaDocument,
  ) {
    const { t } = context;
    this.element.className = "status-bar";
    const spacer = window.document.createElement("span");
    spacer.className = "spacer";
    this.save.className = "save-status";
    this.save.title = context.isMac
      ? t("macOS saves automatically; ⌘S saves right away.")
      : t("Lauda saves automatically; %@ saves right away.", context.shortcut("S"));
    this.element.append(this.words, this.characters, this.reading, spacer, this.save);
    this.counts = new CountsModel((text) => context.worker.count(text));
    this.counts.onChange(() => this.renderCounts());
    this.unsubscribe = document.onChange(() => this.update());
    // "Saved · 10:42" names a time, which the clock can make stale only by
    // the minute; the label is read again now and then.
    this.clock = window.setInterval(() => this.renderSave(), 30_000);
    this.update();
  }

  private update(): void {
    this.renderSave();
    this.counts.update(() => this.document.text);
  }

  private renderCounts(): void {
    const counts = this.counts.counts;
    if (counts === null) return;
    const { t, strings } = this.context;
    this.words.textContent = t("%lld words", counts.words);
    this.characters.textContent = t("%lld characters", counts.characters);
    const reading = readingTimeLabel(counts.words, strings);
    this.reading.textContent = reading ?? "";
    this.reading.hidden = reading === null;
  }

  private renderSave(): void {
    const { status, label } = saveStatusOf(this.document, this.context.strings);
    this.save.dataset.status = status.kind;
    this.save.dataset.color = saveStatusColor(status);
    this.save.innerHTML = `${drawnIcons[saveStatusIcon(status)]}<span></span>`;
    (this.save.lastElementChild as HTMLElement).textContent = label;
  }

  destroy(): void {
    this.unsubscribe();
    this.counts.stop();
    window.clearInterval(this.clock);
  }
}
