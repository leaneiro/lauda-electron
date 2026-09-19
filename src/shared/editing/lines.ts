// Lines as the ported rules see them. The Electron editor keeps its text with
// "\n" line breaks (CodeMirror's default), so lines here end at "\n" only,
// where NSString's lineRange also ends them at \r, U+2028 and U+2029.

/// Where the line holding `location` starts.
export function lineStart(text: string, location: number): number {
  return location <= 0 ? 0 : text.lastIndexOf("\n", location - 1) + 1;
}

/// The line holding `location`: where it starts, and its text without the
/// line break.
export function lineAt(text: string, location: number): { start: number; text: string } {
  const start = lineStart(text, location);
  const newline = text.indexOf("\n", start);
  return { start, text: text.slice(start, newline === -1 ? text.length : newline) };
}
