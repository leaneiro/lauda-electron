// HTMLRendererTests.swift, with the same expected strings.
import { describe, expect, it } from "vitest";
import { render, renderForPrint, renderWithLines } from "../../src/shared/markdown";

describe("HTML renderer", () => {
  it("renders a heading", () => {
    expect(render("## Title")).toBe("<h2>Title</h2>\n");
  });

  it("renders a paragraph with inline styles", () => {
    expect(render("Some **bold**, *italic* and `code`.")).toBe(
      "<p>Some <strong>bold</strong>, <em>italic</em> and <code>code</code>.</p>\n",
    );
  });

  it("renders strikethrough", () => {
    expect(render("~~struck~~")).toBe("<p><del>struck</del></p>\n");
  });

  it("escapes HTML in text", () => {
    expect(render("a < b & c > d")).toContain("a &lt; b &amp; c &gt; d");
  });

  it("escapes and highlights a code block with a language", () => {
    const html = render("```swift\nlet x = a < b\n```");
    expect(html.startsWith('<pre class="keep"><code class="language-swift">')).toBe(true);
    expect(html).toContain('<span class="hl-kw">let</span> x = a &lt; b');
  });

  it("keeps a code block without a language plain", () => {
    expect(render("```\nlet x = a < b\n```")).toBe('<pre class="keep"><code>let x = a &lt; b\n</code></pre>\n');
  });

  it("lets a long code block break across pages", () => {
    const code = Array.from({ length: 10 }, (_, index) => `let v${index + 1} = ${index + 1}`).join("\n");
    const html = render(`\`\`\`swift\n${code}\n\`\`\``);
    // A long block has no class=keep.
    expect(html.startsWith("<pre><code")).toBe(true);
  });

  it("renders a link", () => {
    expect(render("[site](https://example.com)")).toBe('<p><a href="https://example.com">site</a></p>\n');
  });

  it("renders an image", () => {
    expect(render("![alt](figure.png)")).toBe('<p><img src="figure.png" alt="alt"></p>\n');
  });

  it("renders an unordered list", () => {
    expect(render("- one\n- two")).toBe("<ul>\n<li>one</li>\n<li>two</li>\n</ul>\n");
  });

  it("renders an ordered list with a custom start", () => {
    expect(render("3. three\n4. four").startsWith('<ol start="3">')).toBe(true);
  });

  it("renders a task list", () => {
    const html = render("- [x] done\n- [ ] pending");
    expect(html).toContain('<li class="task"><input type="checkbox" disabled checked> done</li>');
    expect(html).toContain('<li class="task"><input type="checkbox" disabled> pending</li>');
  });

  it("renders a block quote", () => {
    expect(render("> quote")).toBe("<blockquote>\n<p>quote</p>\n</blockquote>\n");
  });

  it("renders a thematic break", () => {
    expect(render("---")).toBe("<hr>\n");
  });

  it("renders a table with alignments", () => {
    const html = render("| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |");
    expect(html).toContain('<th style="text-align:left">a</th>');
    expect(html).toContain('<th style="text-align:center">b</th>');
    expect(html).toContain('<td style="text-align:right">3</td>');
  });

  it("renders a hard line break", () => {
    expect(render("line one  \nline two")).toContain("<br>");
  });

  it("turns a single Enter into a line break", () => {
    expect(render("first line\nsecond line")).toBe("<p>first line<br>\nsecond line</p>\n");
  });

  it("folds a single Enter like CommonMark in strict mode", () => {
    expect(render("first line\nsecond line", { strictLineBreaks: true })).toBe("<p>first line\nsecond line</p>\n");
  });

  it("still honors hard breaks in strict mode", () => {
    expect(render("line one  \nline two", { strictLineBreaks: true })).toContain("line one<br>\nline two");
  });

  it("applies strict mode to print rendering", () => {
    expect(renderForPrint("# T\n\na\nb", { strictLineBreaks: true })).toContain("<p>a\nb</p>");
    expect(renderForPrint("# T\n\na\nb")).toContain("<p>a<br>\nb</p>");
  });

  it("maps each top-level block with renderWithLines", () => {
    const markdown = "# Title\n\nParagraph one\ncontinues\n\n- a\n- b\n\n```\ncode\n```\n";
    const result = renderWithLines(markdown);
    // The heading, the paragraph, the list with its two items, the code.
    expect(result.anchorLines).toEqual([0, 2, 5, 5, 6, 8]);
    expect(result.lineCount).toBe(12);
    expect(result.html).toBe(render(markdown));
  });

  it("anchors table rows", () => {
    const result = renderWithLines("| h |\n| - |\n| r |\n| s |");
    // The table, its head row, then one anchor per body row.
    expect(result.anchorLines).toEqual([0, 0, 2, 3]);
  });

  it("anchors nested items in document order", () => {
    const result = renderWithLines("- a\n  - b\n- c");
    // The list, item a, the nested item b inside it, then item c.
    expect(result.anchorLines).toEqual([0, 0, 1, 2]);
  });

  it("wraps raw HTML into one element", () => {
    const result = renderWithLines("<div>a</div>\n<div>b</div>\n\ntext");
    expect(result.anchorLines).toEqual([0, 3]);
    expect(result.html.startsWith('<div class="raw"><div>a</div>\n<div>b</div>')).toBe(true);
  });

  // Elements inside raw HTML map to no source line, so they must not shift
  // the anchors that follow them.
  it("skips items inside raw HTML", () => {
    expect(renderWithLines("<ul><li>raw</li></ul>\n\n- real").anchorLines).toEqual([0, 2, 2]);
  });

  it("still starts a new paragraph at a blank line", () => {
    expect(render("one\n\ntwo")).toBe("<p>one</p>\n<p>two</p>\n");
  });

  it("turns a single Enter inside a list item into a line break", () => {
    expect(render("- item\n  continued")).toContain("<li>item<br>\ncontinued</li>");
  });

  it("keeps plain newlines in a code block", () => {
    expect(render("```\na\nb\n```")).not.toContain("<br>");
  });

  it("passes raw HTML through", () => {
    expect(render("<div>block</div>")).toContain("<div>block</div>");
  });

  it("renders an empty document as nothing", () => {
    expect(render("")).toBe("");
  });
});
