import { describe, expect, it } from "vitest";
import { messageOptionsFor } from "../../src/main/message-options";

describe("a message box's options", () => {
  const options = { type: "warning", message: "Save the document first", buttons: ["OK"] };

  it("leave out the icon on Linux, where GTK centres the text", () => {
    expect(messageOptionsFor(options, "linux")).toEqual({ ...options, type: "none" });
  });

  it("keep it on Windows and macOS, which set the text beside it", () => {
    expect(messageOptionsFor(options, "win32")).toBe(options);
    expect(messageOptionsFor(options, "darwin")).toBe(options);
  });
});
