import { readingTime, type SaveStatus, saveStatus } from "../shared/document";
import type { Strings } from "../shared/i18n";
import type { LaudaDocument } from "./document";

/// What the status bar says about a document, in words: the shared
/// computations (src/shared) in the window's language.

/// "~3 min read", or "less than 1 min read"; nothing for an empty document.
export function readingTimeLabel(words: number, strings: Strings): string | null {
  const time = readingTime(words);
  if (!time) return null;
  return time.kind === "lessThanOneMinute"
    ? strings.t("less than 1 min read")
    : strings.t("~%lld min read", time.minutes);
}

/// The document's save status, and the words the status bar says it with.
export function saveStatusOf(document: LaudaDocument, strings: Strings): { status: SaveStatus; label: string } {
  // A document that has no file yet was never saved, whatever text it
  // started with (the welcome guide starts with some).
  const status = saveStatus({
    text: document.text,
    fileURL: document.filePath,
    lastSavedText: document.filePath ? document.savedText : null,
    lastSaveDate: document.savedDate,
  });
  switch (status.kind) {
    case "notSavedYet":
      return { status, label: strings.t("Not saved yet") };
    case "editing":
      return { status, label: strings.t("Editing…") };
    case "saved": {
      if (!status.date) return { status, label: strings.t("Saved") };
      const time = new Intl.DateTimeFormat(strings.locale, { timeStyle: "short" }).format(status.date);
      return { status, label: strings.t("Saved · %@", time) };
    }
  }
}
