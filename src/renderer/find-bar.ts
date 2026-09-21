import type { ViewMode } from "../shared/settings";
import type { WindowContext } from "./context";
import { element } from "./dom";
import type { FindSession } from "./find";
import { icons } from "./icons";

/// A document's floating find bar (FindBar.swift): the query field, the
/// match counts and the buttons, showing its FindSession.
export class FindBar {
  private readonly bar = element("div", "find-bar");
  private readonly input = element("input");
  private readonly count = element("span", "find-count");
  private readonly previous = element("button");
  private readonly next = element("button");

  constructor(
    context: WindowContext,
    host: HTMLElement,
    private readonly session: FindSession,
    /// The pane that takes the keyboard back when the bar closes, unless the
    /// preview is all there is.
    private readonly editor: { focus(): boolean },
    private readonly mode: () => ViewMode,
  ) {
    const { t } = context;
    this.bar.hidden = true;
    const magnifier = element("span");
    magnifier.innerHTML = icons.magnifier;
    magnifier.style.display = "grid";
    this.input.type = "text";
    this.input.placeholder = t("Find");
    this.input.spellcheck = false;
    this.input.setAttribute("aria-label", t("Find"));
    this.previous.innerHTML = icons.chevronLeft;
    this.next.innerHTML = icons.chevronRight;
    this.previous.title = context.isMac ? t("Previous (⇧⌘G)") : t("Previous (%@)", context.shortcut("G", true));
    this.next.title = context.isMac ? t("Next (⌘G)") : t("Next (%@)", context.shortcut("G"));
    this.previous.setAttribute("aria-label", this.previous.title);
    this.next.setAttribute("aria-label", this.next.title);
    const close = element("button", "find-close");
    close.innerHTML = icons.clearField;
    close.title = t("Close (Esc)");
    close.setAttribute("aria-label", close.title);
    this.bar.append(magnifier, this.input, this.count, this.previous, this.next, close);
    host.append(this.bar);

    this.input.addEventListener("input", () => {
      session.query = this.input.value;
      session.search();
    });
    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        session.step(!event.shiftKey);
      } else if (event.key === "Escape") {
        event.preventDefault();
        session.close();
      }
    });
    this.previous.addEventListener("click", () => session.step(false));
    this.next.addEventListener("click", () => session.step(true));
    close.addEventListener("click", () => session.close());
    session.onChange(() => this.render());
    session.onOpen(() => {
      this.render();
      this.input.focus();
      this.input.select();
    });
    this.render();
  }

  private render(): void {
    const session = this.session;
    // A bar that closes with the keyboard in it hands the keyboard back.
    const handsBackFocus = !this.bar.hidden && !session.isPresented && this.bar.contains(document.activeElement);
    this.bar.hidden = !session.isPresented;
    if (handsBackFocus && this.mode() !== "previewOnly") this.editor.focus();

    if (this.input.value !== session.query) this.input.value = session.query;
    const hasQuery = session.query.length > 0;
    this.count.hidden = !hasQuery;
    this.count.textContent = session.total > 0 ? `${session.current}/${session.total}` : "0";
    this.count.classList.toggle("is-empty", session.total === 0);
    this.previous.disabled = session.total === 0;
    this.next.disabled = session.total === 0;
  }
}
