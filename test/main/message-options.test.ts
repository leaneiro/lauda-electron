import { describe, expect, it } from "vitest";
import { messageOptionsFor } from "../../src/main/message-options";

describe("a message box's options", () => {
  const options = { type: "warning", message: "Save the document first", buttons: ["OK"] };

  it("leave out the icon on Linux and Windows", () => {
    expect(messageOptionsFor(options, "linux")).toEqual({ ...options, type: "none" });
    expect(messageOptionsFor(options, "win32")).toEqual({ ...options, type: "none" });
  });

  it("keep it on macOS", () => {
    expect(messageOptionsFor(options, "darwin")).toBe(options);
  });
});
