import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { editorPhraseKeys, editorPhrases } from "../../src/renderer/editor/phrases";
import { Strings } from "../../src/shared/i18n";

const nodeRequire = createRequire(import.meta.url);

/// The phrases a CodeMirror package asks for, as its code names them.
function phrasesIn(packageName: string): string[] {
  const code = readFileSync(nodeRequire.resolve(packageName), "utf8");
  return [...code.matchAll(/phrase\((?:\w+, )?"([^"]+)"/g)].map((match) => match[1] ?? "");
}

/// What the editor never shows: the go-to-line panel has no key in Lauda's
/// keymap, and control characters aren't drawn as placeholders.
const unused = new Set(["Go to line", "go", "Control character"]);

describe("the editor's phrases", () => {
  /// A CodeMirror update that brings a phrase of its own fails here, rather
  /// than showing it in English.
  it("translate every phrase CodeMirror's panel and commands ask for", () => {
    const asked = ["@codemirror/search", "@codemirror/commands", "@codemirror/view"].flatMap(phrasesIn);
    expect(asked.length).toBeGreaterThan(10);
    const missing = [...new Set(asked)].filter((phrase) => !unused.has(phrase) && !(phrase in editorPhraseKeys));
    expect(missing).toEqual([]);
  });

  it("read in the reader's language", () => {
    const strings = new Strings("pt-BR", false);
    const state = EditorState.create({ extensions: editorPhrases((key, ...args) => strings.t(key, ...args)) });
    expect(state.phrase("Find")).toBe("Localizar");
    expect(state.phrase("replace all")).toBe("Substituir Tudo");
    expect(state.phrase("match case")).toBe("Diferenciar maiúsculas");
    expect(state.phrase("replaced $ matches", 3)).toBe("ocorrências substituídas: 3");
  });
});
