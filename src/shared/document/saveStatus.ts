/// What the status bar says about saving a document. The wording is the
/// caller's, from the native keys "Not saved yet", "Saved", "Saved · %@" and
/// "Editing…". The %@ is the save's time, which the native app writes with
/// the user's short time style (Intl.DateTimeFormat's timeStyle "short").
export type SaveStatus =
  /// A new document that has never been written.
  | { kind: "notSavedYet" }
  /// The text on screen is what was last written. `date` is when this window
  /// saw that save; null for a file shown as it was on disk.
  | { kind: "saved"; date: Date | null }
  /// The text changed since the last save, which autosave will catch up on.
  | { kind: "editing" };

export interface SaveStatusInput {
  /// The text on screen.
  text: string;
  /// Where the document lives (a path or a file URL), null for a new one;
  /// only whether there is one matters.
  fileURL: string | null;
  /// The text last written, or read from disk; null when this window has
  /// seen neither.
  lastSavedText: string | null;
  /// When this window saw the last save.
  lastSaveDate: Date | null;
}

export function saveStatus({ text, fileURL, lastSavedText, lastSaveDate }: SaveStatusInput): SaveStatus {
  if (fileURL === null && lastSavedText === null) return { kind: "notSavedYet" };
  if (text === lastSavedText) return { kind: "saved", date: lastSaveDate };
  return { kind: "editing" };
}

/// The SF Symbol the native status bar shows beside the words, for an icon
/// set of the caller's own to go by.
export type SaveStatusIcon = "circle.dotted" | "checkmark.circle.fill" | "ellipsis.circle.fill";

export function saveStatusIcon(status: SaveStatus): SaveStatusIcon {
  switch (status.kind) {
    case "notSavedYet":
      return "circle.dotted";
    case "saved":
      return "checkmark.circle.fill";
    case "editing":
      return "ellipsis.circle.fill";
  }
}

/// The icon's color: the secondary text color, green or orange.
export type SaveStatusColor = "secondary" | "green" | "orange";

export function saveStatusColor(status: SaveStatus): SaveStatusColor {
  switch (status.kind) {
    case "notSavedYet":
      return "secondary";
    case "saved":
      return "green";
    case "editing":
      return "orange";
  }
}
