import { describe, expect, it } from "vitest";
import { describeFailure, logLine } from "../../src/main/log-line";

describe("the log", () => {
  it("keeps a file error's code, never its message, which holds the path", () => {
    const error = Object.assign(new Error("ENOENT: no such file or directory, open '/Users/someone/diary.md'"), {
      code: "ENOENT",
    });
    expect(describeFailure(error)).toBe("ENOENT");
  });

  it("names an error without a code by its kind", () => {
    expect(describeFailure(new SyntaxError('Unexpected token in JSON at position 3: {"secret"'))).toBe("SyntaxError");
    expect(describeFailure("a thrown string")).toBe("string");
    expect(describeFailure(null)).toBe("object");
  });

  it("takes only a code that looks like one", () => {
    expect(describeFailure({ code: "/Users/someone/notes.md" })).toBe("object");
  });

  it("writes one line: when, where, what", () => {
    const when = new Date("2026-09-21T12:00:00Z");
    expect(logLine("files", "Watching a document's folder failed (ENOSPC)", when)).toBe(
      "2026-09-21T12:00:00.000Z files: Watching a document's folder failed (ENOSPC)\n",
    );
    expect(logLine("app", "two\nlines", when)).toBe("2026-09-21T12:00:00.000Z app: two lines\n");
  });
});
