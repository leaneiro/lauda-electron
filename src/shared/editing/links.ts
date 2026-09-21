import { allowedLinkSchemes as allowedSchemes } from "../markdown/content-policy";
import { trimmingWhitespaces, trimmingWhitespacesAndNewlines } from "./characters";
import { substring, type TextEdit, type TextRange } from "./textEdit";

/// The link schemes allowed to leave the app are the content policy's, the
/// same the renderer keeps and the preview opens.
export { allowedSchemes };

/// Whether clipboard text is a link to make one of: a single token with an
/// allowed scheme, and a host unless it's mailto.
///
/// The native check leans on Foundation's URL parser, so this one follows
/// what that parser accepts on macOS (checked against URL(string:)): a path,
/// query or fragment may hold anything, as Foundation escapes it, while a host
/// with characters no host name has, a stray percent sign, an unclosed IP
/// literal or a port that isn't a number makes no URL at all. International
/// host names aren't put through IDNA as Foundation does, so the few it turns
/// down pass here.
export function isLikelyURL(string: string): boolean {
  if (string === "" || /\p{White_Space}/u.test(string)) return false;
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(string);
  const name = scheme?.[1]?.toLowerCase();
  if (scheme === null || name === undefined) return false;
  if (!allowedSchemes.has(name)) return false;

  const rest = string.slice(scheme[0].length);
  if (!rest.startsWith("//")) return name === "mailto";
  const afterSlashes = rest.slice(2);
  const end = afterSlashes.search(/[/?#]/);
  const authority = end === -1 ? afterSlashes : afterSlashes.slice(0, end);
  // "https://" has no host, while "https://user@" has an empty one.
  return isValidAuthority(authority) && (authority !== "" || name === "mailto");
}

/// Pasting a URL over selected text makes the selection a link,
/// `[text](url)`, with the caret after it (EditorTextView.paste, once the
/// clipboard turned out to hold no image, see pasteIntent). Null when the
/// paste should go ahead as usual: nothing is selected, the clipboard isn't a
/// URL, or the selection spans lines or is a URL itself.
export function smartLinkPaste(text: string, selection: TextRange, clipboard: string | null): TextEdit | null {
  if (selection.length === 0 || clipboard === null) return null;
  const url = trimmingWhitespacesAndNewlines(clipboard);
  if (!isLikelyURL(url)) return null;
  const selected = substring(text, selection);
  if (selected.includes("\n") || isLikelyURL(trimmingWhitespaces(selected))) return null;
  const replacement = `[${selected}](${url})`;
  return {
    range: selection,
    replacement,
    selection: { location: selection.location + replacement.length, length: 0 },
  };
}

// What Foundation turns down in a host name: characters no host has,
// controls, and a percent sign that doesn't start an escape.
const badHostName = /["<>[\\\]^`{|}\p{Cc}]|%(?![0-9A-Fa-f]{2})/u;
const portSuffix = /^(?::[0-9]*)?$/;

/// Whether Foundation takes `authority`: anything up to its last "@" (the
/// user part, which it escapes as needed), then a host, bracketed when it's
/// an IP literal, and an optional port made of digits.
function isValidAuthority(authority: string): boolean {
  const hostAndPort = authority.slice(authority.lastIndexOf("@") + 1);
  if (hostAndPort.startsWith("[")) {
    const close = hostAndPort.indexOf("]");
    return close !== -1 && portSuffix.test(hostAndPort.slice(close + 1));
  }
  const colon = hostAndPort.indexOf(":");
  const host = colon === -1 ? hostAndPort : hostAndPort.slice(0, colon);
  const port = colon === -1 ? "" : hostAndPort.slice(colon);
  return !badHostName.test(host) && portSuffix.test(port);
}
