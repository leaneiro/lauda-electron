import {
  characterCount as countCharacters,
  wordCount as countWords,
  readingTime,
  type SaveStatus,
  saveStatus,
} from "../shared/document";
import { outlineItems as headings } from "../shared/markdown";
import { strings, t } from "./api";
import type { LaudaDocument } from "./document";

/// What the status bar and the outline say about a document, in words: the
/// shared computations (src/shared) with the window's language.

export function wordCount(text: string, _locale: string): number {
  return countWords(text);
}

export function characterCount(text: string): number {
  return countCharacters(text);
}

/// "~3 min read", or "less than 1 min read"; nothing for an empty document.
export function readingTimeLabel(words: number): string | null {
  const time = readingTime(words);
  if (!time) return null;
  return time.kind === "lessThanOneMinute" ? t("less than 1 min read") : t("~%lld min read", time.minutes);
}

/// The document's save status, and the words the status bar says it with.
export function saveStatusOf(document: LaudaDocument): { status: SaveStatus; label: string } {
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
      return { status, label: t("Not saved yet") };
    case "editing":
      return { status, label: t("Editing…") };
    case "saved": {
      if (!status.date) return { status, label: t("Saved") };
      const time = new Intl.DateTimeFormat(strings().locale, { timeStyle: "short" }).format(status.date);
      return { status, label: t("Saved · %@", time) };
    }
  }
}

export function outlineItems(text: string): { level: number; title: string; line: number }[] {
  return headings(text);
}
