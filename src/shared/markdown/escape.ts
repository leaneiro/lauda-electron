// HTMLRenderer.escape, in a module of its own so the renderer and the code
// highlighter can both use it without importing each other.

/// Escapes text for HTML content and double-quoted attribute values.
///
/// Every `&<>"` is replaced. Foundation's replacingOccurrences, which the
/// native app uses, compares whole characters, so it leaves one of them
/// alone when a combining mark follows it (`"` + U+0301), which can end an
/// attribute early; this port doesn't reproduce that.
export function escapeHTML(string: string): string {
  return string
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
