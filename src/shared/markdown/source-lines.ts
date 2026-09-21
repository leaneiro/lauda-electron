// Source-line arithmetic for the renderer (SourceLines.swift); the editor
// counts lines with CodeMirror's own model. Lines split on "\n" only, matching the line numbers
// the Markdown parser reports. JavaScript strings are UTF-16, like NSString,
// so offsets are the same numbers the native editor uses.

/// Number of lines: newlines + 1 (a trailing newline opens an empty line).
export function sourceLineCount(text: string): number {
  let count = 1;
  for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) {
    count += 1;
  }
  return count;
}
