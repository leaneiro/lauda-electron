import { characterCount as countCharacters, readingTime, saveStatus, wordCount as countWords } from "../shared/document";
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

export function saveStatusOf(document: LaudaDocument): { kind: "notSavedYet" | "saved" | "editing"; label: string } {
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
      return { kind: status.kind, label: t("Not saved yet") };
    case "editing":
      return { kind: status.kind, label: t("Editing…") };
    case "saved": {
      if (!status.date) return { kind: status.kind, label: t("Saved") };
      const time = new Intl.DateTimeFormat(strings().locale, { timeStyle: "short" }).format(status.date);
      return { kind: status.kind, label: t("Saved · %@", time) };
    }
  }
}

export function outlineItems(text: string): { level: number; title: string; line: number }[] {
  return headings(text);
}
