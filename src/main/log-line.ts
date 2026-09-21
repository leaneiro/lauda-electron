/// The parts of the app a log line can concern.
export type LogCategory = "app" | "documents" | "files" | "fonts" | "preview" | "settings";

/// What a failure says in the log: the error's code when it has one
/// (ENOENT, EACCES), else its kind (SyntaxError). Never its message, which
/// for a file error spells out the path, and a path names the reader's
/// files, which the log never does (the native app's rule as well).
export function describeFailure(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^[A-Z0-9_]+$/.test(code)) return code;
  if (error instanceof Error) return error.name;
  return typeof error;
}

/// One line of the log: when, where in the app, and what happened.
export function logLine(category: LogCategory, message: string, now = new Date()): string {
  return `${now.toISOString()} ${category}: ${message.replace(/\s+/g, " ").trim()}\n`;
}
