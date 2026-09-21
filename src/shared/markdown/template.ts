// The preview's page policies and the self-contained export page
// (PreviewTemplate.swift). Pure strings: the caller reads the stylesheet and
// the wordmark font and passes them in.

import { documentScheme } from "./content-policy";
import { escapeHTML } from "./escape";

/// Content Security Policy of the live preview. The document's raw HTML
/// can't run script (tags, inline handlers, javascript: URLs) or open
/// connections. Images and media may come from the document's folder,
/// data: URIs or the web, and https embeds (iframes) still load. Fonts only
/// come from data: URIs, which is how the wordmark face is embedded, so
/// nothing is fetched for them.
export const previewContentSecurityPolicy = [
  "default-src 'none'",
  `img-src ${documentScheme}: data: https: http:`,
  `media-src ${documentScheme}: data: https: http:`,
  "style-src 'unsafe-inline'",
  "font-src data:",
  "frame-src https:",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

/// Exported documents load whatever the document references but, like the
/// preview, never run its scripts.
export const exportContentSecurityPolicy =
  "script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

/// The face behind the `.wordmark` class: Newsreader SemiBold at the 72 pt
/// optical size, the typeface of the app icon's L, cut down to the letters
/// of "Lauda" (LaudaWordmark.woff, SIL Open Font License). Embedded as a
/// data URI, so the preview, exported HTML and PDF all have it without
/// fetching anything.
export function wordmarkFontFace(woffBase64: string): string {
  return [
    "@font-face {",
    '    font-family: "Lauda Wordmark";',
    `    src: url("data:font/woff;base64,${woffBase64}") format("woff");`,
    "    font-weight: 600;",
    "    font-display: block;",
    "}",
  ].join("\n");
}

/// Stylesheet shared by the live preview and exported documents: the
/// wordmark's @font-face, then preview.css (PreviewTemplate.styles). The
/// native app leaves the face empty when the font file is missing.
export function previewStyles(fontFace: string, stylesheet: string): string {
  return `${fontFace}\n${stylesheet}`;
}

export interface StandaloneOptions {
  readonly title: string;
  readonly bodyHTML: string;
  /// The whole stylesheet, as `previewStyles` builds it.
  readonly styles: string;
  /// A CSS font-family list.
  readonly fontFamily: string;
  /// In CSS pixels.
  readonly fontSize: number;
  readonly lineHeight: number;
  /// UI language, used as the page's lang (hyphenation, CJK font choice).
  readonly language?: string;
}

/// Self-contained document (no scripts) for HTML/PDF export, styled like
/// the preview and honoring the user's preview font settings.
export function standalone(options: StandaloneOptions): string {
  return [
    "<!DOCTYPE html>",
    `<html lang="${options.language ?? "en"}">`,
    "<head>",
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${exportContentSecurityPolicy}">`,
    `<title>${escapeHTML(options.title)}</title>`,
    "<style>",
    options.styles,
    ":root {",
    `    --pfont: ${options.fontFamily};`,
    `    --psize: ${swiftDescription(options.fontSize)}px;`,
    `    --plh: ${swiftDescription(options.lineHeight)};`,
    "}",
    "</style>",
    "</head>",
    "<body>",
    '<article id="content">',
    options.bodyHTML,
    "</article>",
    "</body>",
    "</html>",
  ].join("\n");
}

/// How Swift prints a Double, which the native page interpolates: always a
/// fraction digit ("18.0"), and exponent notation beyond 2^53 and below
/// 1e-4 ("1e+16", "1e-05"). Both languages print the shortest digits that
/// read back as the same number.
export function swiftDescription(value: number): string {
  if (Number.isNaN(value)) return "nan";
  if (!Number.isFinite(value)) return value > 0 ? "inf" : "-inf";
  if (value === 0) return Object.is(value, -0) ? "-0.0" : "0.0";
  const sign = value < 0 ? "-" : "";
  const magnitude = Math.abs(value);
  const [mantissa = "0", exponentText = "0"] = magnitude.toExponential().split("e");
  const exponent = Number(exponentText);
  if (magnitude > 2 ** 53 || exponent < -4) {
    const digits = String(Math.abs(exponent)).padStart(2, "0");
    return `${sign}${mantissa}e${exponent < 0 ? "-" : "+"}${digits}`;
  }
  const digits = mantissa.replace(".", "");
  if (exponent < 0) return `${sign}0.${"0".repeat(-exponent - 1)}${digits}`;
  const integerDigits = exponent + 1;
  if (digits.length <= integerDigits) return `${sign}${digits.padEnd(integerDigits, "0")}.0`;
  return `${sign}${digits.slice(0, integerDigits)}.${digits.slice(integerDigits)}`;
}
