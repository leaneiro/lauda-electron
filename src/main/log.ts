import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import { describeFailure, type LogCategory, logLine } from "./log-line";

// What the app writes down when something fails or goes wrong, one line
// each, in the folder the system keeps logs in, so that a report from
// Windows or Linux comes with something to read. It holds what happened and
// where, never a document's text nor a file's name or path (see
// describeFailure).

/// Past this size the log starts over, keeping the previous one aside.
const maxSize = 512 * 1024;

function logFolder(): string {
  // Tests bring a data folder of their own, and their logs go there too.
  const userData = process.env.LAUDA_USER_DATA;
  return userData ? join(userData, "logs") : app.getPath("logs");
}

function write(line: string): void {
  try {
    const folder = logFolder();
    mkdirSync(folder, { recursive: true });
    const file = join(folder, "lauda.log");
    try {
      if (statSync(file).size > maxSize) renameSync(file, join(folder, "lauda.old.log"));
    } catch {
      // No log yet: the append below starts one.
    }
    appendFileSync(file, line);
  } catch {
    // A log that can't be written can't say so; stderr still gets the line.
  }
  process.stderr.write(line);
}

/// Something failed: `what` says what was being done ("Watching a
/// document's folder"), in words that name no file.
export function logFailure(category: LogCategory, what: string, error: unknown): void {
  write(logLine(category, `${what} failed (${describeFailure(error)})`));
}

/// Something that went wrong without an error to describe, in words that
/// name no file (a window that stopped responding).
export function logNote(category: LogCategory, message: string): void {
  write(logLine(category, message));
}

/// A process the app runs besides this one ended when it shouldn't have:
/// the GPU's, a page's, the network's. The line names the process and why
/// (crashed, killed, out of memory, failed to launch).
export function logProcessesGone(): void {
  app.on("child-process-gone", (_event, details) => {
    if (details.reason === "clean-exit") return;
    const process = details.name ?? details.type;
    logNote("app", `The ${process} process went: ${details.reason} (exit code ${details.exitCode})`);
  });
  app.on("render-process-gone", (_event, _contents, details) => {
    if (details.reason === "clean-exit") return;
    logNote("app", `A page's process went: ${details.reason} (exit code ${details.exitCode})`);
  });
}

/// A failure the window reported: `what` and the error's `kind`, both
/// checked, since the window says them.
export function logWindowFailure(what: unknown, kind: unknown): void {
  const said = typeof what === "string" ? what.slice(0, 120) : "Something";
  const named = typeof kind === "string" && /^[A-Za-z]{1,40}$/.test(kind) ? kind : "unknown";
  write(logLine("preview", `${said} failed (${named})`));
}
