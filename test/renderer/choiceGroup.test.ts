// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChoiceGroup } from "../../src/renderer/choice-group";

type Mode = "one" | "two" | "three";

describe("ChoiceGroup", () => {
  let chosen: string[];
  let group: ChoiceGroup<Mode>;

  const buttons = () => [...group.element.querySelectorAll<HTMLButtonElement>("button")];
  const press = (key: string) =>
    buttons()
      .find((button) => button === document.activeElement)
      ?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

  beforeEach(() => {
    chosen = [];
    group = new ChoiceGroup<Mode>(
      "segmented",
      "Mode",
      [
        { value: "one", label: "One" },
        { value: "two", label: "Two", icon: "<svg></svg>" },
        { value: "three", label: "Three" },
      ],
      // The owner shows what was chosen, as the title bar and the Settings
      // form do.
      (value, by) => {
        chosen.push(`${value} by ${by}`);
        group.show(value);
      },
    );
    document.body.append(group.element);
    group.show("two");
  });
  afterEach(() => {
    group.element.remove();
  });

  it("reads as a radio group with its label", () => {
    expect(group.element.getAttribute("role")).toBe("radiogroup");
    expect(group.element.getAttribute("aria-label")).toBe("Mode");
    expect(buttons().map((button) => button.getAttribute("role"))).toEqual(["radio", "radio", "radio"]);
  });

  it("names a choice by its text, or by its label when it shows an icon", () => {
    const [one, two] = buttons();
    expect(one?.textContent).toBe("One");
    expect(two?.getAttribute("aria-label")).toBe("Two");
    expect(two?.title).toBe("Two");
  });

  it("shows the choice that holds, and is one stop for the Tab key", () => {
    expect(buttons().map((button) => button.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
    expect(buttons().map((button) => button.tabIndex)).toEqual([-1, 0, -1]);
  });

  it("chooses what is clicked", () => {
    buttons()[2]?.click();
    expect(chosen).toEqual(["three by pointer"]);
  });

  it("chooses with the arrows as they go, and keeps the keyboard on the group", () => {
    buttons()[1]?.focus();
    press("ArrowRight");
    expect(chosen).toEqual(["three by keys"]);
    expect(document.activeElement).toBe(buttons()[2]);
    press("ArrowRight");
    expect(chosen).toEqual(["three by keys", "one by keys"]);
    expect(document.activeElement).toBe(buttons()[0]);
    press("End");
    press("Home");
    expect(chosen).toEqual(["three by keys", "one by keys", "three by keys", "one by keys"]);
  });

  it("leaves other keys alone", () => {
    buttons()[1]?.focus();
    press("Enter");
    press("ArrowDown");
    expect(chosen).toEqual([]);
  });
});
