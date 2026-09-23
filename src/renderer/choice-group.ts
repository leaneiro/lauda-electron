import { rowTarget } from "../shared/keyboard-row";
import { element } from "./dom";

/// How a choice was made: a click, or the keys that walk the group, which
/// keep the keyboard on it.
export type ChosenBy = "pointer" | "keys";

/// One of a choice group's buttons.
export interface Choice<T extends string> {
  value: T;
  /// What a screen reader says of it; the tooltip too when it shows an icon.
  label: string;
  /// The icon it shows; without one, it shows its label.
  icon?: string;
}

/// One choice of a few, all in view (the view modes, the appearance): the
/// segmented control of the native app, and a radio group to a screen
/// reader. It is one stop for the Tab key, the choice that holds, and the
/// arrows, Home and End choose as they go, as in the tab strip
/// (keyboard-row.ts).
export class ChoiceGroup<T extends string> {
  readonly element: HTMLElement;
  private readonly buttons: { value: T; button: HTMLButtonElement }[] = [];
  private chosen: T | null = null;

  constructor(
    className: string,
    label: string,
    choices: readonly Choice<T>[],
    private readonly choose: (value: T, by: ChosenBy) => void,
  ) {
    this.element = element("div", className);
    this.element.setAttribute("role", "radiogroup");
    this.element.setAttribute("aria-label", label);
    for (const choice of choices) {
      const button = element("button");
      button.type = "button";
      button.setAttribute("role", "radio");
      if (choice.icon) {
        button.innerHTML = choice.icon;
        button.title = choice.label;
        button.setAttribute("aria-label", choice.label);
      } else {
        button.textContent = choice.label;
      }
      button.addEventListener("click", () => choose(choice.value, "pointer"));
      this.buttons.push({ value: choice.value, button });
      this.element.append(button);
    }
    this.element.addEventListener("keydown", (event) => this.key(event));
  }

  /// Shows `value` as the choice that holds, and makes it the group's stop.
  show(value: T): void {
    this.chosen = value;
    for (const { value: candidate, button } of this.buttons) {
      const holds = candidate === value;
      button.setAttribute("aria-checked", String(holds));
      button.tabIndex = holds ? 0 : -1;
    }
  }

  private key(event: KeyboardEvent): void {
    const current = this.buttons.findIndex(({ value }) => value === this.chosen);
    const next = this.buttons[rowTarget(event.key, current, this.buttons.length) ?? -1];
    if (!next) return;
    event.preventDefault();
    this.choose(next.value, "keys");
    next.button.focus();
  }
}
