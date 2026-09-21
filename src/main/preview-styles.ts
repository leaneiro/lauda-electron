import { readFileSync } from "node:fs";
import { join } from "node:path";
import { previewStyles, wordmarkFontFace } from "../shared/markdown";
import { logFailure } from "./log";

let cached: string | undefined;

/// The preview's stylesheet with the wordmark's face, shared by the live
/// preview and both exports (PreviewTemplate.styles).
export function previewStylesheet(distDirectory: string): string {
  if (!cached) {
    // The native app's stylesheet, then this app's additions for Chromium.
    const css = ["preview.css", "electron.css"]
      .map((file) => readFileSync(join(distDirectory, "resources/preview", file), "utf8"))
      .join("\n");
    let face = "";
    try {
      face = wordmarkFontFace(
        readFileSync(join(distDirectory, "resources/preview/LaudaWordmark.woff")).toString("base64"),
      );
    } catch (error) {
      // The preview draws the app's name in the system's serif without it.
      logFailure("preview", "Reading the wordmark font", error);
    }
    cached = previewStyles(face, css);
  }
  return cached;
}
