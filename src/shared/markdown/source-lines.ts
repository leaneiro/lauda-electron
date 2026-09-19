// Source-line arithmetic shared by the editor and the renderer
// (SourceLines.swift). Lines split on "\n" only, matching the line numbers
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

/// UTF-16 offsets where each line starts.
export function sourceLineStarts(text: string): number[] {
  const starts = [0];
  for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) {
    starts.push(index + 1);
  }
  return starts;
}

/// Index of the line containing `offset`, given `sourceLineStarts(text)`.
export function sourceLineContaining(offset: number, starts: readonly number[]): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    if (starts[mid] <= offset) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return low;
}
