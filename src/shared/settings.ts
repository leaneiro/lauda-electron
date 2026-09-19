/// Every setting the app stores, with the native app's keys and defaults
/// (AppSettings.swift), so the two read alike.

export type ViewMode = "editorOnly" | "split" | "previewOnly";
export const viewModes: readonly ViewMode[] = ["editorOnly", "split", "previewOnly"];

export type AppearanceMode = "auto" | "light" | "dark";
/// Listed in the Settings picker in this order, Automatic first.
export const appearanceModes: readonly AppearanceMode[] = ["auto", "light", "dark"];

/// The options in the Settings window, which Restore Defaults resets.
export interface Preferences {
  appearanceMode: AppearanceMode;
  editorFontName: string;
  editorFontSize: number;
  previewFontName: string;
  previewFontSize: number;
  previewLineHeight: number;
  strictLineBreaks: boolean;
}

/// Remembered state, which Restore Defaults leaves alone.
export interface RememberedState {
  lastViewMode: ViewMode;
  previewWidthLevel: number;
  hasShownWelcomeGuide: boolean;
  splitFraction: number;
}

export type Settings = Preferences & RememberedState;

export const defaultPreferences: Preferences = {
  appearanceMode: "auto",
  editorFontName: "system-mono",
  editorFontSize: 14,
  previewFontName: "system-sans",
  previewFontSize: 16,
  previewLineHeight: 1.65,
  strictLineBreaks: false,
};

export const defaultRememberedState: RememberedState = {
  lastViewMode: "split",
  previewWidthLevel: 0,
  hasShownWelcomeGuide: false,
  splitFraction: 0.5,
};

export const defaultSettings: Settings = { ...defaultPreferences, ...defaultRememberedState };

/// The ranges of the Settings window's sliders.
export const limits = {
  editorFontSize: { min: 10, max: 24, step: 1 },
  previewFontSize: { min: 12, max: 28, step: 1 },
  previewLineHeight: { min: 1.2, max: 2.2, step: 0.05 },
} as const;

/// Reads stored values defensively: anything missing, of the wrong type or
/// out of range falls back to its default.
export function sanitizeSettings(stored: unknown): Settings {
  const input = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>;
  const pick = <K extends keyof Settings>(key: K, valid: (value: unknown) => boolean): Settings[K] =>
    (valid(input[key]) ? input[key] : defaultSettings[key]) as Settings[K];
  const inRange = (min: number, max: number) => (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
  const isString = (v: unknown) => typeof v === "string" && v.length > 0;
  return {
    appearanceMode: pick("appearanceMode", (v) => appearanceModes.includes(v as AppearanceMode)),
    editorFontName: pick("editorFontName", isString),
    editorFontSize: pick("editorFontSize", inRange(limits.editorFontSize.min, limits.editorFontSize.max)),
    previewFontName: pick("previewFontName", isString),
    previewFontSize: pick("previewFontSize", inRange(limits.previewFontSize.min, limits.previewFontSize.max)),
    previewLineHeight: pick("previewLineHeight", inRange(limits.previewLineHeight.min, limits.previewLineHeight.max)),
    strictLineBreaks: pick("strictLineBreaks", (v) => typeof v === "boolean"),
    lastViewMode: pick("lastViewMode", (v) => viewModes.includes(v as ViewMode)),
    previewWidthLevel: pick("previewWidthLevel", (v) => v === 0 || v === 1 || v === 2),
    hasShownWelcomeGuide: pick("hasShownWelcomeGuide", (v) => typeof v === "boolean"),
    splitFraction: pick("splitFraction", inRange(0, 1)),
  };
}

/// Content-column width for the preview in preview-only mode.
export const previewWidths = [
  { level: 0, key: "Normal", rem: 46 },
  { level: 1, key: "Medium", rem: 66 },
  { level: 2, key: "Wide", rem: 90 },
] as const;

/// The width a window shows for a stored level: levels only apply in
/// preview-only mode, every other mode stays normal.
export function previewWidthShowing(level: number, mode: ViewMode) {
  if (mode !== "previewOnly") return previewWidths[0];
  return previewWidths[level] ?? previewWidths[0];
}

export function nextPreviewWidthLevel(level: number): number {
  return (level + 1) % previewWidths.length;
}

/// Font identifiers stored in settings. Besides real family names, three
/// sentinel values map to the system's own fonts, on every platform.
export const FontOption = {
  systemSans: "system-sans",
  systemSerif: "system-serif",
  systemMono: "system-mono",
} as const;

export const specialFontOptions = [
  { id: FontOption.systemSans, key: "System (Sans)" },
  { id: FontOption.systemSerif, key: "System (Serif)" },
  { id: FontOption.systemMono, key: "System (Mono)" },
] as const;

/// The CSS font-family for a stored font id. The system stacks name the
/// Mac's fonts first, as the native app does, then Windows's and Linux's.
export function cssFontFamily(id: string): string {
  switch (id) {
    case FontOption.systemSans:
      return `-apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI", system-ui, "Helvetica Neue", "Noto Sans", Ubuntu, Cantarell, sans-serif`;
    case FontOption.systemSerif:
      return `ui-serif, "New York", Georgia, Cambria, "Noto Serif", "DejaVu Serif", serif`;
    case FontOption.systemMono:
      return `ui-monospace, "SF Mono", Menlo, "Cascadia Mono", Consolas, "Noto Sans Mono", "DejaVu Sans Mono", "Liberation Mono", monospace`;
    default:
      return `"${id.replace(/["\\]/g, "")}", ${cssFontFamily(FontOption.systemSans)}`;
  }
}

/// A monospaced family, whichever the editor's font is, for the fallback
/// behind a chosen font.
export function cssEditorFontFamily(id: string): string {
  if (id === FontOption.systemSans || id === FontOption.systemSerif || id === FontOption.systemMono) {
    return cssFontFamily(id);
  }
  return `"${id.replace(/["\\]/g, "")}", ${cssFontFamily(FontOption.systemMono)}`;
}
