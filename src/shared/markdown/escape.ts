// HTMLRenderer.escape, in a module of its own so the renderer and the code
// highlighter can both use it without importing each other.

/// Escapes text for HTML content and double-quoted attribute values.
///
/// Every `&<>"` is replaced, compared unit by unit as the native app's
/// escape compares them: a combining mark after one of them (`"` + U+0301)
/// still leaves a character to escape, so a quote never ends an attribute
/// early.
export function escapeHTML(string: string): string {
  return string.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
