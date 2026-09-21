/// The welcome guide is written once, with the Mac's keys, since the native
/// app is where it comes from. Windows and Linux read the same guide with
/// their own: ⇧⌘X becomes Ctrl+Shift+X, and the tables it sits in are lined
/// up again afterwards, the names being longer than the symbols.

/// The two the menus spell differently off the Mac (menu.ts): Find and
/// Replace follows the convention there, and exporting HTML gives up its
/// shortcut, Ctrl+Alt being AltGr on many keyboards.
const exceptions = new Map([
  ["⌥⌘F", "Ctrl+H"],
  ["⌥⇧⌘E", ""],
]);

/// A run of modifier symbols and the key they hold, e.g. "⇧⌘X".
const shortcut = /([⌃⌥⇧⌘]+)(\S)/gu;

function inCtrlTerms(modifiers: string, key: string): string {
  const parts: string[] = [];
  if (modifiers.includes("⌘") || modifiers.includes("⌃")) parts.push("Ctrl");
  if (modifiers.includes("⌥")) parts.push("Alt");
  if (modifiers.includes("⇧")) parts.push("Shift");
  parts.push(key);
  return parts.join("+");
}

/// A shortcut with nothing to say for itself, in the parentheses it is
/// usually given in: the parentheses go with it.
const parenthesised = /[ {2}]?\(([⌃⌥⇧⌘]+\S)\)/gu;

/// The text with every Mac shortcut written the way Windows and Linux spell
/// it. Text without any is returned as it came.
export function withCtrlShortcuts(text: string): string {
  const withoutGoneOnes = text.replace(parenthesised, (whole, inside: string) =>
    exceptions.get(inside.toUpperCase()) === "" ? "" : whole,
  );
  const converted = withoutGoneOnes.replace(shortcut, (whole, modifiers: string, key: string) => {
    const exception = exceptions.get(whole.toUpperCase());
    if (exception !== undefined) return exception;
    return inCtrlTerms(modifiers, key);
  });
  return converted === text ? text : alignTables(converted);
}

/// Pads the cells of every Markdown table so its columns line up again,
/// leaving the rest of the text alone.
function alignTables(text: string): string {
  const lines = text.split("\n");
  const isRow = (line: string) => line.trimStart().startsWith("|") && line.trimEnd().endsWith("|");
  const cellsOf = (line: string) => line.trim().slice(1, -1).split("|");
  const isDivider = (cells: string[]) => cells.every((cell) => /^\s*:?-+:?\s*$/.test(cell));

  const isRowAt = (index: number) => {
    const line = lines[index];
    return line !== undefined && isRow(line);
  };
  let start = 0;
  while (start < lines.length) {
    if (!isRowAt(start)) {
      start += 1;
      continue;
    }
    let end = start;
    while (isRowAt(end + 1)) end += 1;

    const rows = lines.slice(start, end + 1).map(cellsOf);
    const columns = Math.max(...rows.map((row) => row.length));
    const widths: number[] = [];
    for (let column = 0; column < columns; column++) {
      const cells = rows.filter((row) => !isDivider(row)).map((row) => (row[column] ?? "").trim());
      widths[column] = Math.max(1, ...cells.map((cell) => [...cell].length));
    }
    rows.forEach((row, index) => {
      const cells = row.map((cell, column) => {
        const width = widths[column] ?? 1;
        if (isDivider(row)) {
          const trimmed = cell.trim();
          const left = trimmed.startsWith(":") ? ":" : "";
          const right = trimmed.endsWith(":") ? ":" : "";
          return ` ${left}${"-".repeat(Math.max(width - left.length - right.length, 1))}${right} `;
        }
        const value = cell.trim();
        return ` ${value}${" ".repeat(Math.max(width - [...value].length, 0))} `;
      });
      lines[start + index] = `|${cells.join("|")}|`;
    });
    start = end + 1;
  }
  return lines.join("\n");
}
