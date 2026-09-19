// CodeHighlighterTests.swift, with the same expected strings.
import { describe, expect, it } from "vitest";
import { highlightCode } from "../../src/shared/markdown";

function highlighted(code: string, language: string): string {
  const html = highlightCode(code, language);
  expect(html).not.toBeNull();
  return html!;
}

describe("code highlighter", () => {
  it("highlights Swift keywords, strings, comments and numbers", () => {
    const html = highlighted('// hi\nlet x = "a < b" + 42', "swift");
    expect(html).toContain('<span class="hl-com">// hi</span>');
    expect(html).toContain('<span class="hl-kw">let</span>');
    expect(html).toContain('<span class="hl-str">&quot;a &lt; b&quot;</span>');
    expect(html).toContain('<span class="hl-num">42</span>');
  });

  it("doesn't highlight a keyword inside a string", () => {
    const html = highlighted('print("let if for")', "swift");
    expect(html).toContain('<span class="hl-str">&quot;let if for&quot;</span>');
    expect(html).not.toContain("hl-kw");
  });

  it("doesn't wrap a keyword inside a comment twice", () => {
    const html = highlighted("# for x in y\n", "python");
    expect(html).toContain('<span class="hl-com"># for x in y</span>');
    expect(html).not.toContain("hl-kw");
  });

  it("doesn't end a string at an escaped quote", () => {
    const html = highlighted('let s = "a\\"b"', "swift");
    expect(html).toContain('<span class="hl-str">&quot;a\\&quot;b&quot;</span>');
  });

  it("spans lines with a block comment", () => {
    const html = highlighted("/* a\nb */ let x", "swift");
    expect(html).toContain('<span class="hl-com">/* a\nb */</span>');
    expect(html).toContain('<span class="hl-kw">let</span>');
  });

  it("returns null for an unknown language", () => {
    expect(highlightCode("let x = 1", "brainfuck")).toBeNull();
    expect(highlightCode("let x = 1", null)).toBeNull();
  });

  it("always escapes HTML", () => {
    const html = highlighted("<script>alert('1')</script>", "javascript");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
  });

  it.each([["ts", "const a = 1"], ["sh", "echo hi"], ["sql", "SELECT 1"]])(
    "knows the alias %s",
    (alias, code) => {
      expect(highlightCode(code, alias)).not.toBeNull();
    },
  );

  it("doesn't crash or loop on an unterminated string", () => {
    expect(highlighted('let s = "unclosed', "swift")).toContain("hl-str");
  });

  // Beyond the Swift tests: details of the native output the port keeps.

  it("reads the language from the first word of the info string", () => {
    expect(highlightCode("let x", "  Swift title=x")).toBe('<span class="hl-kw">let</span> x');
  });

  it("wraps each number, with underscores and a fraction, and leaves identifiers alone", () => {
    expect(highlighted("let n = 1_000.5 + x2", "swift"))
      .toBe('<span class="hl-kw">let</span> n = <span class="hl-num">1_000.5</span> + x2');
  });

  it("treats a delimiter followed by a combining mark as one character, as Swift does", () => {
    // "#" + U+FE0F + U+20E3 is the keycap emoji, not a comment.
    expect(highlighted("echo #️⃣", "bash")).toBe('<span class="hl-kw">echo</span> #️⃣');
  });
});
