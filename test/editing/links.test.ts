import { describe, expect, it } from "vitest";
import { allowedSchemes, isLikelyURL, smartLinkPaste } from "../../src/shared/editing";

describe("isLikelyURL", () => {
  it.each(["https://example.com/page", "http://example.com"])("accepts HTTP and HTTPS: %s", (text) => {
    expect(isLikelyURL(text)).toBe(true);
  });

  it.each(["just text", "file:///etc/passwd", "text with https://example.com inside", ""])(
    "rejects plain text and other schemes: %j",
    (text) => {
      expect(isLikelyURL(text)).toBe(false);
    },
  );

  it("allows the schemes the preview lets out of the app", () => {
    expect([...allowedSchemes].sort()).toEqual(["http", "https", "mailto"]);
  });

  // What the native check answers, as Foundation's URL(string:) decides on macOS.
  it.each([
    ["HTTPS://EXAMPLE.COM", true],
    ["mailto:someone@example.com", true],
    ["mailto:", true],
    ["https://user@", true],
    ["https://:80/x", true],
    ["https://host:80", true],
    ["http://[::1]:8080/", true],
    ["https://例え.jp", true],
    ["https://example.com/a<b>", true],
    ["https://example.com/%", true],
    ["https://a:b@c", true],
    ["https://", false],
    ["https:///path", false],
    ["http:example.com", false],
    ["https://?q", false],
    ["https://host:port", false],
    ["https://example.com:8080:9090", false],
    ["http://[invalid", false],
    ["https://[::1]x", false],
    ["http://ex%ZZample.com", false],
    ["https://exa<mple.com", false],
    ["https://exa`mple.com", false],
    ["mailto://a<b", false],
    ["javascript:alert(1)", false],
    ["//example.com", false],
    ["1http://x", false],
    ["https://a\xA0b", false],
  ] as const)("answers %j as Foundation does: %s", (text, expected) => {
    expect(isLikelyURL(text)).toBe(expected);
  });
});

// EditorTextView.paste's smart link, which has no Swift test of its own.
describe("smartLinkPaste", () => {
  it("makes the selection a link to the pasted URL, with the caret after it", () => {
    const text = "see docs here";
    const edit = smartLinkPaste(text, { location: 4, length: 4 }, "https://example.com\n");
    expect(edit).toEqual({
      range: { location: 4, length: 4 },
      replacement: "[docs](https://example.com)",
      selection: { location: 31, length: 0 },
    });
  });

  it("pastes as usual otherwise", () => {
    const text = "one\ntwo https://a.com";
    expect(smartLinkPaste(text, { location: 0, length: 0 }, "https://example.com")).toBeNull();
    expect(smartLinkPaste(text, { location: 0, length: 3 }, "not a url")).toBeNull();
    expect(smartLinkPaste(text, { location: 0, length: 3 }, null)).toBeNull();
    expect(smartLinkPaste(text, { location: 0, length: 7 }, "https://example.com")).toBeNull();
    expect(smartLinkPaste(text, { location: 7, length: 14 }, "https://example.com")).toBeNull();
  });
});
