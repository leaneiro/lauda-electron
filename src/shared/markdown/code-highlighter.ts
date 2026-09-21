// Minimal, dependency-free syntax highlighter for fenced code blocks in the
// preview and exports (CodeHighlighter.swift). Scanner-based and deliberately
// modest: comments, strings, numbers and keywords, enough color to read code
// comfortably. The output is the native one, span for span.

import { escapeHTML } from "./escape";

interface StringDelimiter {
  readonly open: string;
  readonly close: string;
  readonly escapes: boolean;
}

interface Language {
  readonly lineComments: readonly string[];
  readonly blockComments: readonly { readonly open: string; readonly close: string }[];
  /// Ordered longest-first so `"""` wins over `"`.
  readonly stringDelimiters: readonly StringDelimiter[];
  readonly keywords: ReadonlySet<string>;
}

/// Returns span-annotated escaped HTML, or null for unknown languages
/// (the caller falls back to plain escaping). `language` is a code block's
/// whole info string; its first word names the language.
export function highlightCode(code: string, language: string | null | undefined): string | null {
  const key = language
    ?.split(" ")
    .find((word) => word.length > 0)
    ?.toLowerCase();
  const spec = key === undefined ? undefined : languages.get(key);
  return spec ? tokenize(code, spec) : null;
}

// MARK: - Tokenizer

function tokenize(code: string, spec: Language): string {
  const chars = characters(code);
  let html = "";
  let plain = "";
  let i = 0;

  const matches = (delimiter: string, index: number): boolean => {
    if (index + delimiter.length > chars.length) return false;
    for (let k = 0; k < delimiter.length; k += 1) {
      if (chars[index + k] !== delimiter[k]) return false;
    }
    return true;
  };
  const flushPlain = (): void => {
    if (plain.length === 0) return;
    html += stylePlain(plain, spec.keywords);
    plain = "";
  };
  const span = (cssClass: string, from: number, to: number): string =>
    `<span class="${cssClass}">${escapeHTML(chars.slice(from, to).join(""))}</span>`;

  outer: while (i < chars.length) {
    for (const prefix of spec.lineComments) {
      if (!matches(prefix, i)) continue;
      flushPlain();
      let j = i;
      while (j < chars.length && chars[j] !== "\n") j += 1;
      html += span("hl-com", i, j);
      i = j;
      continue outer;
    }
    for (const block of spec.blockComments) {
      if (!matches(block.open, i)) continue;
      flushPlain();
      let j = i + block.open.length;
      while (j < chars.length && !matches(block.close, j)) j += 1;
      const end = Math.min(j + block.close.length, chars.length);
      html += span("hl-com", i, end);
      i = end;
      continue outer;
    }
    for (const string of spec.stringDelimiters) {
      if (!matches(string.open, i)) continue;
      let j = i + string.open.length;
      while (j < chars.length) {
        if (string.escapes && chars[j] === "\\") {
          j += 2;
          continue;
        }
        if (matches(string.close, j)) {
          j += string.close.length;
          break;
        }
        j += 1;
      }
      const end = Math.min(j, chars.length);
      flushPlain();
      html += span("hl-str", i, end);
      i = end;
      continue outer;
    }
    plain += chars[i];
    i += 1;
  }
  flushPlain();
  return html;
}

/// The code's Swift Characters (grapheme clusters), which the native scanner
/// steps through: a delimiter followed by a combining mark, or the "\r" of
/// "\r\n", is part of a larger character and matches nothing. ASCII text
/// without "\r" splits the same way character by character, so the common
/// case skips the segmenter.
function characters(code: string): string[] {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the ASCII range, control characters and all, is what the fast path takes.
  if (!/[^\x00-\x0C\x0E-\x7F]/.test(code)) return code.split("");
  return Array.from(graphemes.segment(code), (piece) => piece.segment);
}

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

/// Escapes a plain segment, then wraps keywords and numeric literals.
function stylePlain(text: string, keywords: ReadonlySet<string>): string {
  const escaped = escapeHTML(text);
  let result = "";
  let cursor = 0;
  for (const match of escaped.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
    const word = match[0];
    if (!keywords.has(word)) continue;
    result += wrapNumbers(escaped.slice(cursor, match.index));
    result += `<span class="hl-kw">${word}</span>`;
    cursor = match.index + word.length;
  }
  return result + wrapNumbers(escaped.slice(cursor));
}

/// Wraps what the native `\b\d[\d_]*(?:\.[\d_]+)?\b` matches in ICU, whose
/// `\d` is any decimal digit and whose `\b` skips combining marks. Each call
/// sees one segment, whose ends count as boundaries, as in the native code.
function wrapNumbers(escapedText: string): string {
  let result = "";
  let cursor = 0;
  let index = 0;
  while (index < escapedText.length) {
    const end = numberEnd(escapedText, index);
    if (end === null) {
      index += codePointLength(escapedText, index);
      continue;
    }
    result += escapedText.slice(cursor, index);
    result += `<span class="hl-num">${escapedText.slice(index, end)}</span>`;
    cursor = end;
    index = end;
  }
  return result + escapedText.slice(cursor);
}

/// End of the number starting at `start`, or null, trying the longest
/// match first as the regex's greedy quantifiers do.
function numberEnd(text: string, start: number): number | null {
  if (!isDigit(text, start) || !isWordBoundary(text, start)) return null;
  const digitsAndUnderscores = (from: number): number[] => {
    const ends: number[] = [];
    let position = from;
    while (position < text.length && (isDigit(text, position) || text[position] === "_")) {
      position += codePointLength(text, position);
      ends.push(position);
    }
    return ends;
  };
  const afterFirst = start + codePointLength(text, start);
  const integerEnds = [afterFirst, ...digitsAndUnderscores(afterFirst)];
  // Longest first: the number ends where the most digits still leave a
  // word boundary behind them.
  for (const integerEnd of [...integerEnds].reverse()) {
    if (text[integerEnd] === ".") {
      const fractionEnds = digitsAndUnderscores(integerEnd + 1);
      const fractionEnd = [...fractionEnds].reverse().find((end) => isWordBoundary(text, end));
      if (fractionEnd !== undefined) return fractionEnd;
    }
    if (isWordBoundary(text, integerEnd)) return integerEnd;
  }
  return null;
}

/// ICU's default `\b`: a change between word and non-word characters, where
/// combining marks and format characters belong to the character before.
function isWordBoundary(text: string, position: number): boolean {
  let currentIsWord = false;
  if (position < text.length) {
    const current = String.fromCodePoint(text.codePointAt(position) ?? 0);
    if (combining.test(current)) return false;
    currentIsWord = wordCharacter.test(current);
  }
  let previousIsWord = false;
  let index = position;
  while (index > 0) {
    const previous = characterBefore(text, index);
    index -= previous.length;
    if (!combining.test(previous)) {
      previousIsWord = wordCharacter.test(previous);
      break;
    }
  }
  return currentIsWord !== previousIsWord;
}

const wordCharacter = /^[\p{Alphabetic}\p{M}\p{Nd}\p{Pc}\u200C\u200D]$/u;
const combining = /^[\p{Grapheme_Extend}\p{Cf}]$/u;
const digit = /^\p{Nd}$/u;

function isDigit(text: string, position: number): boolean {
  const point = text.codePointAt(position);
  return point !== undefined && digit.test(String.fromCodePoint(point));
}

function codePointLength(text: string, position: number): number {
  return (text.codePointAt(position) ?? 0) > 0xffff ? 2 : 1;
}

function characterBefore(text: string, position: number): string {
  const low = text.charCodeAt(position - 1);
  if (low >= 0xdc00 && low <= 0xdfff && position >= 2) {
    const high = text.charCodeAt(position - 2);
    if (high >= 0xd800 && high <= 0xdbff) return text.slice(position - 2, position);
  }
  return text[position - 1] ?? "";
}

// MARK: - Language table

function language(parts: Partial<Omit<Language, "keywords">> & { keywords: readonly string[] }): Language {
  return {
    lineComments: parts.lineComments ?? [],
    blockComments: parts.blockComments ?? [],
    stringDelimiters: parts.stringDelimiters ?? [],
    keywords: new Set(parts.keywords),
  };
}

function delimiters(...list: [open: string, close: string, escapes: boolean][]): StringDelimiter[] {
  return list.map(([open, close, escapes]) => ({ open, close, escapes }));
}

const languages: ReadonlyMap<string, Language> = (() => {
  const cStrings = delimiters(['"', '"', true], ["'", "'", true]);
  const cComments = [{ open: "/*", close: "*/" }];

  const swift = language({
    lineComments: ["//"],
    blockComments: cComments,
    stringDelimiters: delimiters(['"""', '"""', true], ['"', '"', true]),
    keywords: [
      "let",
      "var",
      "func",
      "class",
      "struct",
      "enum",
      "protocol",
      "extension",
      "import",
      "if",
      "else",
      "guard",
      "switch",
      "case",
      "default",
      "for",
      "while",
      "repeat",
      "in",
      "return",
      "break",
      "continue",
      "where",
      "as",
      "is",
      "try",
      "catch",
      "throw",
      "throws",
      "rethrows",
      "do",
      "defer",
      "init",
      "deinit",
      "self",
      "Self",
      "super",
      "nil",
      "true",
      "false",
      "static",
      "final",
      "public",
      "private",
      "fileprivate",
      "internal",
      "open",
      "override",
      "mutating",
      "lazy",
      "weak",
      "unowned",
      "typealias",
      "associatedtype",
      "some",
      "any",
      "await",
      "async",
      "actor",
      "convenience",
      "required",
      "indirect",
      "subscript",
      "get",
      "set",
      "willSet",
      "didSet",
      "inout",
    ],
  });
  const kotlin = language({
    lineComments: ["//"],
    blockComments: cComments,
    stringDelimiters: delimiters(['"""', '"""', true], ['"', '"', true], ["'", "'", true]),
    keywords: [
      "fun",
      "val",
      "var",
      "class",
      "object",
      "interface",
      "enum",
      "data",
      "sealed",
      "if",
      "else",
      "when",
      "for",
      "while",
      "do",
      "return",
      "break",
      "continue",
      "in",
      "is",
      "as",
      "try",
      "catch",
      "finally",
      "throw",
      "import",
      "package",
      "null",
      "true",
      "false",
      "this",
      "super",
      "companion",
      "init",
      "constructor",
      "override",
      "open",
      "abstract",
      "final",
      "private",
      "public",
      "protected",
      "internal",
      "lateinit",
      "by",
      "lazy",
      "suspend",
      "inline",
      "reified",
      "out",
      "vararg",
      "typealias",
      "where",
    ],
  });
  const java = language({
    lineComments: ["//"],
    blockComments: cComments,
    stringDelimiters: cStrings,
    keywords: [
      "abstract",
      "assert",
      "boolean",
      "break",
      "byte",
      "case",
      "catch",
      "char",
      "class",
      "const",
      "continue",
      "default",
      "do",
      "double",
      "else",
      "enum",
      "extends",
      "final",
      "finally",
      "float",
      "for",
      "if",
      "implements",
      "import",
      "instanceof",
      "int",
      "interface",
      "long",
      "native",
      "new",
      "package",
      "private",
      "protected",
      "public",
      "record",
      "return",
      "short",
      "static",
      "super",
      "switch",
      "synchronized",
      "this",
      "throw",
      "throws",
      "try",
      "var",
      "void",
      "volatile",
      "while",
      "null",
      "true",
      "false",
      "sealed",
      "permits",
    ],
  });
  const javascript = language({
    lineComments: ["//"],
    blockComments: cComments,
    stringDelimiters: delimiters(["`", "`", true], ['"', '"', true], ["'", "'", true]),
    keywords: [
      "function",
      "var",
      "let",
      "const",
      "class",
      "extends",
      "implements",
      "interface",
      "if",
      "else",
      "switch",
      "case",
      "default",
      "for",
      "while",
      "do",
      "return",
      "break",
      "continue",
      "new",
      "delete",
      "typeof",
      "instanceof",
      "in",
      "of",
      "try",
      "catch",
      "finally",
      "throw",
      "import",
      "export",
      "from",
      "as",
      "async",
      "await",
      "yield",
      "this",
      "super",
      "null",
      "undefined",
      "true",
      "false",
      "static",
      "get",
      "set",
      "void",
      "enum",
      "type",
      "declare",
      "readonly",
      "namespace",
    ],
  });
  const python = language({
    lineComments: ["#"],
    stringDelimiters: delimiters(['"""', '"""', true], ["'''", "'''", true], ['"', '"', true], ["'", "'", true]),
    keywords: [
      "def",
      "class",
      "if",
      "elif",
      "else",
      "for",
      "while",
      "in",
      "is",
      "not",
      "and",
      "or",
      "return",
      "yield",
      "import",
      "from",
      "as",
      "try",
      "except",
      "finally",
      "raise",
      "with",
      "lambda",
      "pass",
      "break",
      "continue",
      "global",
      "nonlocal",
      "del",
      "assert",
      "async",
      "await",
      "None",
      "True",
      "False",
      "self",
      "match",
      "case",
    ],
  });
  const go = language({
    lineComments: ["//"],
    blockComments: cComments,
    stringDelimiters: delimiters(["`", "`", false], ['"', '"', true], ["'", "'", true]),
    keywords: [
      "func",
      "var",
      "const",
      "type",
      "struct",
      "interface",
      "map",
      "chan",
      "if",
      "else",
      "switch",
      "case",
      "default",
      "for",
      "range",
      "return",
      "break",
      "continue",
      "goto",
      "fallthrough",
      "defer",
      "go",
      "select",
      "package",
      "import",
      "nil",
      "true",
      "false",
      "iota",
      "make",
      "new",
      "len",
      "cap",
      "append",
      "error",
      "string",
      "int",
      "bool",
      "byte",
      "rune",
      "float64",
    ],
  });
  const rust = language({
    lineComments: ["//"],
    blockComments: cComments,
    stringDelimiters: delimiters(['"', '"', true]),
    keywords: [
      "fn",
      "let",
      "mut",
      "const",
      "static",
      "struct",
      "enum",
      "trait",
      "impl",
      "for",
      "while",
      "loop",
      "if",
      "else",
      "match",
      "return",
      "break",
      "continue",
      "in",
      "as",
      "use",
      "mod",
      "pub",
      "crate",
      "self",
      "Self",
      "super",
      "where",
      "async",
      "await",
      "move",
      "ref",
      "dyn",
      "unsafe",
      "true",
      "false",
      "Some",
      "None",
      "Ok",
      "Err",
      "String",
      "Vec",
      "Option",
      "Result",
    ],
  });
  const cKeywords = [
    "auto",
    "break",
    "case",
    "char",
    "const",
    "continue",
    "default",
    "do",
    "double",
    "else",
    "enum",
    "extern",
    "float",
    "for",
    "goto",
    "if",
    "inline",
    "int",
    "long",
    "register",
    "return",
    "short",
    "signed",
    "sizeof",
    "static",
    "struct",
    "switch",
    "typedef",
    "union",
    "unsigned",
    "void",
    "volatile",
    "while",
    "NULL",
    "true",
    "false",
    "bool",
  ];
  const c = language({
    lineComments: ["//"],
    blockComments: cComments,
    stringDelimiters: cStrings,
    keywords: cKeywords,
  });
  const cpp = language({
    lineComments: ["//"],
    blockComments: cComments,
    stringDelimiters: cStrings,
    keywords: [
      ...cKeywords,
      "class",
      "namespace",
      "template",
      "typename",
      "public",
      "private",
      "protected",
      "virtual",
      "override",
      "new",
      "delete",
      "this",
      "nullptr",
      "try",
      "catch",
      "throw",
      "using",
      "constexpr",
      "auto",
    ],
  });
  const csharp = language({
    lineComments: ["//"],
    blockComments: cComments,
    stringDelimiters: cStrings,
    keywords: [
      "abstract",
      "as",
      "async",
      "await",
      "base",
      "bool",
      "break",
      "case",
      "catch",
      "class",
      "const",
      "continue",
      "default",
      "delegate",
      "do",
      "double",
      "else",
      "enum",
      "event",
      "finally",
      "float",
      "for",
      "foreach",
      "get",
      "if",
      "in",
      "int",
      "interface",
      "internal",
      "is",
      "lock",
      "long",
      "namespace",
      "new",
      "null",
      "object",
      "out",
      "override",
      "private",
      "protected",
      "public",
      "readonly",
      "record",
      "return",
      "sealed",
      "set",
      "static",
      "string",
      "struct",
      "switch",
      "this",
      "throw",
      "try",
      "typeof",
      "using",
      "var",
      "virtual",
      "void",
      "while",
      "true",
      "false",
    ],
  });
  const ruby = language({
    lineComments: ["#"],
    stringDelimiters: cStrings,
    keywords: [
      "def",
      "class",
      "module",
      "if",
      "elsif",
      "else",
      "unless",
      "case",
      "when",
      "while",
      "until",
      "for",
      "in",
      "do",
      "end",
      "return",
      "break",
      "next",
      "begin",
      "rescue",
      "ensure",
      "raise",
      "yield",
      "self",
      "nil",
      "true",
      "false",
      "and",
      "or",
      "not",
      "require",
      "attr_accessor",
      "puts",
      "lambda",
    ],
  });
  const php = language({
    lineComments: ["//", "#"],
    blockComments: cComments,
    stringDelimiters: cStrings,
    keywords: [
      "function",
      "class",
      "interface",
      "trait",
      "extends",
      "implements",
      "public",
      "private",
      "protected",
      "static",
      "const",
      "var",
      "if",
      "else",
      "elseif",
      "switch",
      "case",
      "default",
      "for",
      "foreach",
      "while",
      "do",
      "return",
      "break",
      "continue",
      "new",
      "try",
      "catch",
      "finally",
      "throw",
      "use",
      "namespace",
      "echo",
      "null",
      "true",
      "false",
      "as",
      "match",
      "fn",
    ],
  });
  const bash = language({
    lineComments: ["#"],
    stringDelimiters: delimiters(['"', '"', true], ["'", "'", false]),
    keywords: [
      "if",
      "then",
      "else",
      "elif",
      "fi",
      "for",
      "while",
      "until",
      "do",
      "done",
      "case",
      "esac",
      "function",
      "in",
      "echo",
      "exit",
      "return",
      "local",
      "export",
      "source",
      "set",
      "shift",
      "read",
      "true",
      "false",
    ],
  });
  const sql = language({
    lineComments: ["--"],
    blockComments: cComments,
    stringDelimiters: delimiters(["'", "'", false]),
    keywords: [
      "SELECT",
      "select",
      "FROM",
      "from",
      "WHERE",
      "where",
      "INSERT",
      "insert",
      "INTO",
      "into",
      "VALUES",
      "values",
      "UPDATE",
      "update",
      "SET",
      "set",
      "DELETE",
      "delete",
      "CREATE",
      "create",
      "TABLE",
      "table",
      "ALTER",
      "alter",
      "DROP",
      "drop",
      "JOIN",
      "join",
      "LEFT",
      "left",
      "RIGHT",
      "right",
      "INNER",
      "inner",
      "OUTER",
      "outer",
      "ON",
      "on",
      "AS",
      "as",
      "AND",
      "and",
      "OR",
      "or",
      "NOT",
      "not",
      "NULL",
      "null",
      "ORDER",
      "order",
      "BY",
      "by",
      "GROUP",
      "group",
      "HAVING",
      "having",
      "LIMIT",
      "limit",
      "DISTINCT",
      "distinct",
      "INDEX",
      "index",
      "PRIMARY",
      "primary",
      "KEY",
      "key",
      "FOREIGN",
      "foreign",
    ],
  });
  const json = language({
    stringDelimiters: delimiters(['"', '"', true]),
    keywords: ["true", "false", "null"],
  });
  const yaml = language({
    lineComments: ["#"],
    stringDelimiters: delimiters(['"', '"', true], ["'", "'", false]),
    keywords: ["true", "false", "null", "yes", "no"],
  });
  const css = language({
    blockComments: cComments,
    stringDelimiters: cStrings,
    keywords: [
      "important",
      "inherit",
      "initial",
      "unset",
      "auto",
      "none",
      "var",
      "calc",
      "min",
      "max",
      "clamp",
      "media",
      "root",
      "hover",
      "focus",
      "active",
    ],
  });

  const table = new Map<string, Language>();
  const register = (spec: Language, ...names: string[]): void => {
    for (const name of names) table.set(name, spec);
  };
  register(swift, "swift");
  register(kotlin, "kotlin", "kt", "kts");
  register(java, "java");
  register(javascript, "javascript", "js", "jsx", "typescript", "ts", "tsx");
  register(python, "python", "py");
  register(go, "go", "golang");
  register(rust, "rust", "rs");
  register(c, "c", "h", "objc", "objective-c");
  register(cpp, "cpp", "c++", "cc", "hpp");
  register(csharp, "csharp", "cs", "c#");
  register(ruby, "ruby", "rb");
  register(php, "php");
  register(bash, "bash", "sh", "shell", "zsh", "console");
  register(sql, "sql");
  register(json, "json");
  register(yaml, "yaml", "yml");
  register(css, "css", "scss");
  return table;
})();
