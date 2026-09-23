import { describe, expect, it } from "vitest";
import { rowTarget } from "../../src/shared/keyboard-row";

describe("rowTarget", () => {
  it("moves to the neighbour with the arrows", () => {
    expect(rowTarget("ArrowRight", 0, 3)).toBe(1);
    expect(rowTarget("ArrowLeft", 2, 3)).toBe(1);
  });

  it("goes round from one end to the other", () => {
    expect(rowTarget("ArrowRight", 2, 3)).toBe(0);
    expect(rowTarget("ArrowLeft", 0, 3)).toBe(2);
  });

  it("goes to the ends with Home and End", () => {
    expect(rowTarget("Home", 1, 3)).toBe(0);
    expect(rowTarget("End", 1, 3)).toBe(2);
  });

  it("leaves every other key to others", () => {
    for (const key of ["ArrowUp", "ArrowDown", "Enter", " ", "Tab", "a"]) {
      expect(rowTarget(key, 1, 3), key).toBeNull();
    }
  });

  it("starts at an end when nothing holds yet", () => {
    expect(rowTarget("ArrowRight", -1, 3)).toBe(0);
    expect(rowTarget("ArrowLeft", -1, 3)).toBe(2);
  });

  it("moves nowhere in an empty row", () => {
    expect(rowTarget("ArrowRight", 0, 0)).toBeNull();
    expect(rowTarget("Home", 0, 0)).toBeNull();
  });
});
