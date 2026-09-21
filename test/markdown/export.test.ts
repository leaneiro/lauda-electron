// ExportTests.swift, with the same expected strings. The native test reads
// the bundled stylesheet; here the caller passes the styles in, so a stand-in
// with the print rules plays that part.
import { describe, expect, it } from "vitest";
import { previewStyles, render, renderForPrint, standalone, wordmarkFontFace } from "../../src/shared/markdown";

const stylesheet = "article { margin: auto; }\n@media print { .keep { break-inside: avoid; } }";

describe("export", () => {
  it("puts the rendered content and the styles in the standalone page", () => {
    const html = standalone({
      title: "My Notes",
      bodyHTML: render("# Title\n\nSome **text**."),
      styles: previewStyles("", stylesheet),
      fontFamily: "Georgia, serif",
      fontSize: 18,
      lineHeight: 1.7,
    });
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("<title>My Notes</title>");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>text</strong>");
    expect(html).toContain("--pfont: Georgia, serif;");
    expect(html).toContain("--psize: 18px;");
    expect(html).toContain("--plh: 1.7;");
    // The print CSS comes along.
    expect(html).toContain("@media print");
    // The exported document has no JS.
    expect(html).not.toContain("<script");
  });

  it("escapes the title", () => {
    const html = standalone({
      title: 'a < b & "c"',
      bodyHTML: "",
      styles: "",
      fontFamily: "x",
      fontSize: 16,
      lineHeight: 1.6,
    });
    expect(html).toContain("<title>a &lt; b &amp; &quot;c&quot;</title>");
  });

  it("wraps headings with a probe for print", () => {
    const html = renderForPrint("# Title\n\nParagraph.\n\n## Another\n\nMore text.");
    expect(html).toContain('<div class="keep-with-next keep-pad"><h1>Title</h1>\n<div class="keep-probe"></div></div>');
    expect(html).toContain(
      '<div class="keep-with-next keep-pad"><h2>Another</h2>\n<div class="keep-probe"></div></div>',
    );
    expect(html).toContain("<p>Paragraph.</p>");
    // The regular (preview) render gets no wrappers.
    expect(render("# Title")).not.toContain("keep-with-next");
  });

  it("groups a heading with a compact code block for print", () => {
    const html = renderForPrint("## Code\n\n```swift\nlet x = 1\n```\n\nText after.");
    // The heading and a short block stay together, with no probe.
    expect(html).toContain('<div class="keep-with-next"><h2>Code</h2>\n<pre class="keep">');
    expect(html).not.toContain('<h2>Code</h2>\n<div class="keep-probe">');
    expect(html).toContain("</pre>\n</div>");
    expect(html).toContain("<p>Text after.</p>");
  });

  it("puts a probe before a long code block for print", () => {
    const code = Array.from({ length: 10 }, (_, index) => `let v${index + 1} = ${index + 1}`).join("\n");
    const html = renderForPrint(`## Code\n\n\`\`\`swift\n${code}\n\`\`\``);
    // A long block may break: the heading keeps the probe and the pre flows freely.
    expect(html).toContain('<div class="keep-with-next keep-pad"><h2>Code</h2>\n<div class="keep-probe"></div></div>');
    expect(html).toContain("<pre><code");
  });

  // Exports carry the wordmark face themselves, so the app's name keeps its
  // typeface in HTML and PDF, offline.
  it("embeds the wordmark font in the styles", () => {
    const styles = previewStyles(wordmarkFontFace(btoa("wOFF\0\x01\0\0")), stylesheet);
    expect(styles).toContain('font-family: "Lauda Wordmark"');
    const start = styles.indexOf("data:font/woff;base64,") + "data:font/woff;base64,".length;
    const encoded = styles.slice(start, styles.indexOf('"', start));
    expect(atob(encoded).startsWith("wOFF")).toBe(true);
    expect(styles.endsWith(stylesheet)).toBe(true);
  });

  // The style is passed in, not read from settings, so the test says the
  // same thing on every machine.
  it("applies the given style to the standalone page", () => {
    const html = standalone({
      title: "Doc",
      bodyHTML: renderForPrint("- item"),
      styles: "",
      fontFamily: "ui-serif, serif",
      fontSize: 19,
      lineHeight: 1.5,
    });
    expect(html).toContain("<li>item</li>");
    expect(html).toContain("--psize: 19px;");
  });

  // Beyond the Swift tests: the page, line for line.

  it("lays the standalone page out as the native one", () => {
    const html = standalone({
      title: "T",
      bodyHTML: "<p>x</p>",
      styles: "S",
      fontFamily: "F",
      fontSize: 16.5,
      lineHeight: 2,
      language: "pt-BR",
    });
    expect(html).toBe(
      [
        "<!DOCTYPE html>",
        '<html lang="pt-BR">',
        "<head>",
        '<meta charset="utf-8">',
        "<meta http-equiv=\"Content-Security-Policy\" content=\"script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'\">",
        "<title>T</title>",
        "<style>",
        "S",
        ":root {",
        "    --pfont: F;",
        "    --psize: 16.5px;",
        "    --plh: 2;",
        "}",
        "</style>",
        "</head>",
        "<body>",
        '<article id="content">',
        "<p>x</p>",
        "</article>",
        "</body>",
        "</html>",
      ].join("\n"),
    );
  });
});
