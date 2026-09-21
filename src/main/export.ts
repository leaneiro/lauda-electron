import { showError } from "./dialogs";
import { app, BrowserWindow, dialog } from "electron";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Strings } from "../shared/i18n";
import type { ExportRequest } from "../shared/ipc";
import { cssFontFamily, type Settings } from "../shared/settings";
import { renderForPrint, standalone } from "../shared/markdown";
import { distDirectory, serveExportPage } from "./protocols";
import { previewStylesheet } from "./preview-styles";
import { writeText } from "./files";

/// A self-contained page, styled like the preview and following the
/// preview's font settings.
export function standaloneHTML(request: ExportRequest, settings: Settings): string {
  return standalone({
    title: request.title,
    bodyHTML: renderForPrint(request.markdown, { strictLineBreaks: settings.strictLineBreaks }),
    styles: previewStylesheet(distDirectory),
    fontFamily: cssFontFamily(settings.previewFontName),
    fontSize: settings.previewFontSize,
    lineHeight: settings.previewLineHeight,
    language: app.getLocale(),
  });
}

function startFolder(request: ExportRequest): string {
  return request.filePath ? dirname(request.filePath) : app.getPath("documents");
}

export async function exportHTML(window: BrowserWindow, request: ExportRequest, settings: Settings, strings: Strings) {
  const result = await dialog.showSaveDialog(window, {
    defaultPath: join(startFolder(request), `${request.title}.html`),
    filters: [{ name: strings.t("HTML Document"), extensions: ["html"] }],
    buttonLabel: strings.t("Export"),
  });
  if (result.canceled || !result.filePath) return;
  try {
    await writeText(result.filePath, standaloneHTML(request, settings));
  } catch (error) {
    await showExportError(window, request, error, strings);
  }
}

/// Countries that print on US Letter; everywhere else prints on A4, as the
/// native export follows the region's paper.
const letterCountries = new Set([
  "US",
  "CA",
  "MX",
  "PH",
  "CL",
  "CO",
  "VE",
  "PR",
  "CR",
  "GT",
  "PA",
  "DO",
  "SV",
  "NI",
  "HN",
  "BZ",
]);

export async function exportPDF(window: BrowserWindow, request: ExportRequest, settings: Settings, strings: Strings) {
  const result = await dialog.showSaveDialog(window, {
    defaultPath: join(startFolder(request), `${request.title}.pdf`),
    filters: [{ name: strings.t("PDF Document"), extensions: ["pdf"] }],
    buttonLabel: strings.t("Export"),
  });
  if (result.canceled || !result.filePath) return;

  const page = serveExportPage(request.filePath ? dirname(request.filePath) : null, standaloneHTML(request, settings));
  // Roughly an A4 page at 96 dpi, as the native offscreen web view.
  const printer = new BrowserWindow({
    show: false,
    width: 794,
    height: 1123,
    webPreferences: { sandbox: true, javascript: false, contextIsolation: true },
  });
  try {
    await printer.loadURL(page.url);
    // Give images a moment to finish loading before pagination.
    await new Promise((resolve) => setTimeout(resolve, 400));
    const margin = 42 / 72;
    const pdf = await printer.webContents.printToPDF({
      pageSize: letterCountries.has(app.getLocaleCountryCode()) ? "Letter" : "A4",
      printBackground: true,
      margins: { top: margin, bottom: margin, left: margin, right: margin },
    });
    await writeFile(result.filePath, pdf);
  } catch (error) {
    await showExportError(window, request, error, strings);
  } finally {
    page.done();
    printer.destroy();
  }
}

async function showExportError(window: BrowserWindow, request: ExportRequest, error: unknown, strings: Strings) {
  await showError(window, strings.t("Couldn't export “%@”", request.title), error, strings);
}
