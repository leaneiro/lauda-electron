// The rendering, escaping and policy parts of PreviewSecurityTests.swift and
// SecurityAndDecodingTests.swift. What needs WebKit or the file system (the
// live page, the scheme handler's path resolution, symlinks, text decoding)
// isn't here.
import { describe, expect, it } from "vitest";
import {
  exportContentSecurityPolicy,
  isAllowedLinkDestination,
  isImagePath,
  previewContentSecurityPolicy,
  render,
  standalone,
} from "../../src/shared/markdown";

describe("preview security: links", () => {
  it.each([
    "https://example.com",
    "http://example.com",
    "mailto:someone@example.com",
    "notes.md",
    "./img/a.png",
    "#section",
    "folder/page?x=a:b",
  ])("keeps the external, relative or fragment link %s", (destination) => {
    expect(render(`[x](${destination})`)).toContain("<a href=");
  });

  it.each(["javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,hi", "file:///etc/passwd"])(
    "drops the %s link but keeps its text",
    (destination) => {
      const html = render(`[click me](${destination})`);
      expect(html).not.toContain("<a");
      expect(html).toContain("click me");
    },
  );

  it("ignores whitespace and control characters in the scheme check", () => {
    expect(isAllowedLinkDestination(" java\tscript:alert(1)")).toBe(false);
    expect(isAllowedLinkDestination("java\nscript:alert(1)")).toBe(false);
    expect(isAllowedLinkDestination("page.md#part:two")).toBe(true);
  });
});

describe("preview security: page policies", () => {
  it("blocks the document's scripts in the preview", () => {
    const policy = previewContentSecurityPolicy;
    expect(policy.startsWith("default-src 'none'")).toBe(true);
    expect(policy).not.toContain("script-src");
    expect(policy).not.toContain("connect-src");
  });

  // Fonts only come embedded (the wordmark face), never from the network.
  it("loads fonts only from data URIs in the preview", () => {
    expect(previewContentSecurityPolicy).toContain("font-src data:; ");
  });

  it("still shows images from everywhere in the preview", () => {
    expect(previewContentSecurityPolicy).toContain("img-src lauda-doc: data: https: http:");
  });

  it("blocks scripts in exported documents", () => {
    const html = standalone({
      title: "T",
      bodyHTML: "<p>x</p>",
      styles: "",
      fontFamily: "x",
      fontSize: 16,
      lineHeight: 1.6,
    });
    expect(html).toContain(`content="${exportContentSecurityPolicy}"`);
    expect(exportContentSecurityPolicy.startsWith("script-src 'none'")).toBe(true);
  });
});

describe("preview security: images", () => {
  it("counts icon files as images in the editor and the preview", () => {
    expect(isImagePath("/x/favicon.ico")).toBe(true);
  });

  it.each(["/figure.png", "/img/photo.jpeg", "/PHOTO.PNG"])("serves %s, an image", (path) => {
    expect(isImagePath(path)).toBe(true);
  });

  it.each(["/key.pem", "/notes.md", "/no-extension"])("refuses %s, not an image", (path) => {
    expect(isImagePath(path)).toBe(false);
  });

  // URL.pathExtension: a leading dot names a hidden file, not an extension.
  it("reads the extension of the last component only", () => {
    expect(isImagePath("/x/.png")).toBe(false);
    expect(isImagePath("/x/a.tar.gz")).toBe(false);
    expect(isImagePath("/x/.hidden.gif")).toBe(true);
    expect(isImagePath("C:\\Users\\someone\\figure.webp")).toBe(true);
  });
});

describe("escaping", () => {
  it("escapes attribute values", () => {
    expect(render('![a "b" <c>](x.png "t & \\"q\\"")')).toBe(
      '<p><img src="x.png" alt="a “b” &lt;c&gt;" title="t &amp; &quot;q&quot;"></p>\n',
    );
  });

  it("escapes a link's destination", () => {
    expect(render('[a](<x"y&z>)')).toBe('<p><a href="x&quot;y&amp;z">a</a></p>\n');
  });
});
