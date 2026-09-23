// The document's own HTML, as far as keeping it whole in the preview goes
// (RawHTML.swift).
//
// The preview wraps each top-level block of raw HTML in an element of its
// own (see renderWithLines). An element opened in one block and closed in a
// later one, with Markdown between, would be cut off at the end of its
// wrapper: GitHub's `<details>` with a blank line after the summary, or a
// centred `<div>` around an image. Such blocks share one wrapper instead.

/// Elements that hold nothing, and ones the browser closes by itself when
/// the next block begins: none of them keeps a later block inside.
const neverOpen: ReadonlySet<string> = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
  "p",
  "li",
  "dt",
  "dd",
  "tr",
  "td",
  "th",
  "thead",
  "tbody",
  "tfoot",
  "option",
  "optgroup",
  "colgroup",
  "caption",
  "rb",
  "rt",
  "rtc",
  "rp",
  "html",
  "head",
  "body",
]);

const tag = /<(\/?)([A-Za-z][A-Za-z0-9-]*)(?:\s[^<>]*?)?(\/?)>/g;
const comment = /<!--[\s\S]*?-->/g;

/// The elements still open after `html`'s tags, in the order they opened: a
/// closing tag also closes whatever was opened inside it, as the browser does.
export function openElements(html: string, startingWith: readonly string[] = []): string[] {
  const open = [...startingWith];
  for (const match of html.replace(comment, "").matchAll(tag)) {
    const name = (match[2] ?? "").toLowerCase();
    if (match[1]) {
      const index = open.lastIndexOf(name);
      if (index >= 0) open.length = index;
    } else if (!match[3] && !neverOpen.has(name)) {
      open.push(name);
    }
  }
  return open;
}

/// The last of the rendered blocks that the raw HTML at `start` runs
/// through: `start` itself, unless it leaves an element open that a later
/// block closes. Left open to the end, it stays alone, and the browser
/// closes the element in its wrapper, as it always did.
export function closingIndex(pieces: readonly string[], start: number): number {
  let open = openElements(pieces[start] ?? "");
  let index = start;
  while (open.length > 0) {
    index += 1;
    if (index >= pieces.length) return start;
    open = openElements(pieces[index] ?? "", open);
  }
  return index;
}
