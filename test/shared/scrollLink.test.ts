// ScrollLinkTests.swift, the same cases: which pane a published position
// moves, with the panes scrolling together or apart (the chain on the
// divider).
import { describe, expect, it } from "vitest";
import { movesEditor, movesPreview } from "../../src/shared/scroll-link";

describe("which pane a scroll position moves", () => {
  it("together, each pane follows the other", () => {
    expect(movesPreview("editor", true)).toBe(true);
    expect(movesEditor("preview", true)).toBe(true);
  });

  it("apart, neither pane follows the other", () => {
    expect(movesPreview("editor", false)).toBe(false);
    expect(movesEditor("preview", false)).toBe(false);
  });

  it.each([true, false])("a jump moves both panes (linked: %s)", (linked) => {
    expect(movesEditor("navigation", linked)).toBe(true);
    expect(movesPreview("navigation", linked)).toBe(true);
  });

  it.each([true, false])("a pane never follows itself (linked: %s)", (linked) => {
    expect(movesEditor("editor", linked)).toBe(false);
    expect(movesPreview("preview", linked)).toBe(false);
  });
});
