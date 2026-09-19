// Where micromark and cmark-gfm, which the native app renders with, read
// Markdown differently, the port follows cmark. The expected strings were
// produced by the native renderer.
import { describe, expect, it } from "vitest";
import { render, renderWithLines } from "../../src/shared/markdown";

describe("cmark compatibility: smart punctuation", () => {
  it("curls quotes and turns dashes and ellipses into their characters", () => {
    expect(render('"Hello," she said -- it\'s fine... or not---really.'))
      .toBe("<p>“Hello,” she said – it’s fine… or not—really.</p>\n");
  });

  it("pairs single quotes on cmark's delimiter stack", () => {
    expect(render("'a 'b c' d'")).toBe("<p>‘a ‘b c’ d’</p>\n");
  });

  it("looks past tildes for a quote's neighbours", () => {
    expect(render('a ~"b" x')).toBe("<p>a ~“b” x</p>\n");
  });

  it("leaves escaped quotes and entities straight", () => {
    expect(render("\\'escaped\\' and &quot;entity&quot;")).toBe("<p>'escaped' and &quot;entity&quot;</p>\n");
  });
});

describe("cmark compatibility: task lists", () => {
  it("follows cmark-gfm's checkbox rule", () => {
    // `[X]` counts, a box ending its line doesn't, and "[x]" anywhere on the
    // line checks the item.
    expect(render("- [ ] a\n- [x] b\n- [X] c\n- [ ]\n- [ ] a [x] b")).toBe(
      "<ul>\n"
      + '<li class="task"><input type="checkbox" disabled> a</li>\n'
      + '<li class="task"><input type="checkbox" disabled checked> b</li>\n'
      + '<li class="task"><input type="checkbox" disabled checked> c</li>\n'
      + "<li>[ ]</li>\n"
      + '<li class="task"><input type="checkbox" disabled checked> a [x] b</li>\n'
      + "</ul>\n",
    );
  });

  it("makes no task inside a block quote", () => {
    expect(render("> - [ ] quoted")).toBe("<blockquote>\n<ul>\n<li>[ ] quoted</li>\n</ul>\n</blockquote>\n");
  });

  it("reads the box even when the document defines its label", () => {
    expect(render("- [x] done\n\n[x]: http://e.com"))
      .toBe('<ul>\n<li class="task"><input type="checkbox" disabled checked> done</li>\n</ul>\n');
  });
});

describe("cmark compatibility: tables", () => {
  it("empties a body cell holding just ^, which spans the cell above", () => {
    const result = renderWithLines("| h |\n| - |\n| ^ |\n| x |");
    expect(result.html).toBe(
      "<table>\n<thead>\n<tr><th>h</th></tr>\n</thead>\n<tbody>\n<tr><td></td></tr>\n<tr><td>x</td></tr>\n</tbody>\n</table>\n",
    );
    expect(result.anchorLines).toEqual([0, 0, 2, 3]);
  });

  it("completes short rows and drops extra cells", () => {
    expect(render("| a | b |\n|:--|--:|\n| 1 | 2 |\n| 3 |\n| 4 | 5 | 6 |")).toBe(
      "<table>\n<thead>\n"
      + '<tr><th style="text-align:left">a</th><th style="text-align:right">b</th></tr>\n'
      + "</thead>\n<tbody>\n"
      + '<tr><td style="text-align:left">1</td><td style="text-align:right">2</td></tr>\n'
      + '<tr><td style="text-align:left">3</td><td style="text-align:right"></td></tr>\n'
      + '<tr><td style="text-align:left">4</td><td style="text-align:right">5</td></tr>\n'
      + "</tbody>\n</table>\n",
    );
  });

  it("gives a table that interrupts a paragraph the paragraph's line", () => {
    const result = renderWithLines("text\n| a |\n| - |\n| 1 |");
    expect(result.html).toBe(
      "<p>text</p>\n<table>\n<thead>\n<tr><th>a</th></tr>\n</thead>\n<tbody>\n<tr><td>1</td></tr>\n</tbody>\n</table>\n",
    );
    expect(result.anchorLines).toEqual([0, 0, 0, 3]);
  });
});

describe("cmark compatibility: code", () => {
  it("uses the whole info string as the language class", () => {
    expect(render("```swift  title=x  \nlet x = 1\n```")).toBe(
      '<pre class="keep"><code class="language-swift  title=x">'
      + '<span class="hl-kw">let</span> x = <span class="hl-num">1</span>\n</code></pre>\n',
    );
  });

  it("keeps a block of one empty line apart from an empty block", () => {
    expect(render("```\n\n```")).toBe('<pre class="keep"><code>\n</code></pre>\n');
    expect(render("```\n```")).toBe('<pre class="keep"><code></code></pre>\n');
  });

  it("drops the indentation of a code span's next line", () => {
    expect(render("`a\n  b`")).toBe("<p><code>a b</code></p>\n");
  });
});

describe("cmark compatibility: inlines", () => {
  it("reads an empty destination as no link, and inline code in alt text with its backticks", () => {
    expect(render('[x]() ![a `c` *b*](u "")')).toBe('<p>x <img src="u" alt="a `c` b"></p>\n');
  });

  it("breaks the line hard after two spaces, even behind a tab", () => {
    expect(render("a\t  \nb")).toBe("<p>a<br>\nb</p>\n");
  });

  it("keeps a newline written as a character reference", () => {
    expect(render("a&#10;b")).toBe("<p>a\nb</p>\n");
  });

  it("treats CRLF line endings as newlines", () => {
    expect(render("a\r\nb")).toBe("<p>a<br>\nb</p>\n");
  });

  it("links autolinks but not bare URLs", () => {
    expect(render("https://bare.link and <https://auto.link>"))
      .toBe('<p>https://bare.link and <a href="https://auto.link">https://auto.link</a></p>\n');
  });

  it("reads ![^ as text followed by a link", () => {
    expect(render("![^a](u)")).toBe('<p>!<a href="u">^a</a></p>\n');
  });
});

describe("cmark compatibility: blocks", () => {
  it("gives a paragraph the line of the definitions cmark took from its top", () => {
    expect(renderWithLines("[a]: /u\nbar")).toEqual({ html: "<p>bar</p>\n", anchorLines: [0], lineCount: 2 });
  });

  it("keeps an unclosed HTML block's lines as they are", () => {
    expect(renderWithLines("<style\n\n").html).toBe('<div class="raw"><style\n\n</div>\n');
  });
});
