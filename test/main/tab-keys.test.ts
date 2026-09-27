import { describe, expect, it } from "vitest";
import { tabKeyCommand } from "../../src/main/tab-keys";

describe("the keys that walk the tabs", () => {
  const press = { type: "keyDown", key: "Tab", control: true, shift: false, alt: false, meta: false };

  it("are Ctrl+Tab and Ctrl+Shift+Tab", () => {
    expect(tabKeyCommand(press)).toBe("next-tab");
    expect(tabKeyCommand({ ...press, shift: true })).toBe("previous-tab");
  });

  it("leave every other key alone", () => {
    expect(tabKeyCommand({ ...press, control: false })).toBeNull();
    expect(tabKeyCommand({ ...press, alt: true })).toBeNull();
    expect(tabKeyCommand({ ...press, meta: true })).toBeNull();
    expect(tabKeyCommand({ ...press, key: "a" })).toBeNull();
    expect(tabKeyCommand({ ...press, type: "keyUp" })).toBeNull();
  });
});
