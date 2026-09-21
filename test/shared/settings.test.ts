import { describe, expect, test } from "vitest";
import { clampSplit, isSmoothModeChange } from "../../src/shared/layout";
import {
  cssFontFamily,
  defaultSettings,
  nextPreviewWidthLevel,
  previewWidthShowing,
  sanitizeSettings,
} from "../../src/shared/settings";

describe("settings", () => {
  test("defaults are the native app's", () => {
    expect(defaultSettings).toMatchObject({
      appearanceMode: "auto",
      editorFontName: "system-mono",
      editorFontSize: 14,
      previewFontName: "system-sans",
      previewFontSize: 16,
      previewLineHeight: 1.65,
      strictLineBreaks: false,
      lastViewMode: "split",
      previewWidthLevel: 0,
      splitFraction: 0.5,
    });
  });

  test("anything stored wrong falls back to its default", () => {
    const settings = sanitizeSettings({
      editorFontSize: 99,
      appearanceMode: "sepia",
      splitFraction: 0.3,
      previewWidthLevel: 5,
      strictLineBreaks: "yes",
    });
    expect(settings.editorFontSize).toBe(14);
    expect(settings.appearanceMode).toBe("auto");
    expect(settings.splitFraction).toBe(0.3);
    expect(settings.previewWidthLevel).toBe(0);
    expect(settings.strictLineBreaks).toBe(false);
    expect(sanitizeSettings(null)).toEqual(defaultSettings);
  });

  test("width levels only apply in preview-only mode, and cycle", () => {
    expect(previewWidthShowing(2, "split").rem).toBe(46);
    expect(previewWidthShowing(2, "previewOnly").rem).toBe(90);
    expect(previewWidthShowing(1, "previewOnly").rem).toBe(66);
    expect([0, 1, 2].map(nextPreviewWidthLevel)).toEqual([1, 2, 0]);
  });

  test("a chosen font falls back to the system's, and can't break out of its quotes", () => {
    expect(cssFontFamily("Georgia")).toMatch(/^"Georgia", -apple-system/);
    expect(cssFontFamily('Evil"; } body { x')).toMatch(/^"Evil; } body { x"/);
  });
});

describe("layout", () => {
  test("the divider keeps both panes at least 280 wide", () => {
    expect(clampSplit(0.1, 1000)).toBeCloseTo(0.28);
    expect(clampSplit(0.95, 1000)).toBeCloseTo(0.72);
    expect(clampSplit(0.4, 1000)).toBe(0.4);
    expect(clampSplit(0.2, 500)).toBe(0.5);
  });

  test("long texts don't animate the editor changing width", () => {
    const long = 50_001;
    expect(isSmoothModeChange("split", "editorOnly", 4000)).toBe(true);
    expect(isSmoothModeChange("split", "editorOnly", long)).toBe(false);
    expect(isSmoothModeChange("editorOnly", "split", long)).toBe(false);
    expect(isSmoothModeChange("split", "previewOnly", long)).toBe(true);
    expect(isSmoothModeChange("previewOnly", "editorOnly", long)).toBe(true);
  });
});
