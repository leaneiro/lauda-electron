import { describe, expect, it } from "vitest";
import {
  OpenPairs,
  deletingBackward,
  isInsideCode,
  maxRange,
  substitution,
  typing,
  type TextRange,
  type Typing,
} from "../../src/shared/editing";

/// Text with the caret as ‸, or a selection between « and ».
function parse(marked: string): { text: string; selection: TextRange } {
  const caret = marked.indexOf("‸");
  if (caret !== -1) {
    return { text: marked.replace("‸", ""), selection: { location: caret, length: 0 } };
  }
  const open = marked.indexOf("«");
  const close = marked.indexOf("»");
  if (open !== -1 && close !== -1) {
    const text = marked.replaceAll("«", "").replaceAll("»", "");
    return { text, selection: { location: open, length: close - open - 1 } };
  }
  return { text: marked, selection: { location: marked.length, length: 0 } };
}

function render(text: string, selection: TextRange): string {
  const before = text.slice(0, selection.location);
  const after = text.slice(maxRange(selection));
  if (selection.length === 0) return before + "‸" + after;
  return before + "«" + text.slice(selection.location, maxRange(selection)) + "»" + after;
}

/// The native editor reduced to its text, selection, open pairs and what an
/// input method is composing, driving AutoPairing the way EditorTextView and
/// MarkdownTextView.Coordinator do (and the CodeMirror integration must):
/// every change reports its range to OpenPairs before it's applied, every
/// selection change reports the selection, a pair opens once its edit and
/// selection are in, and Delete asks AutoPairing first. Keys arrive one at a
/// time, as insertText receives them.
class Editor {
  text: string;
  selection: TextRange;
  readonly pairs = new OpenPairs();
  /// What an input method is still composing (a dead key's accent), which
  /// the character it commits replaces; the native marked range.
  private composing: TextRange | null = null;

  constructor(marked = "") {
    ({ text: this.text, selection: this.selection } = parse(marked));
  }

  get state(): string {
    return render(this.text, this.selection);
  }

  type(keys: string): void {
    for (const key of keys) this.insertText(key);
  }

  deleteBackward(times = 1): void {
    for (let count = 0; count < times; count += 1) {
      if (!this.handleDeleteBackward()) this.deleteBackwardAsUsual();
    }
  }

  moveCaret(location: number): void {
    this.setSelectedRange({ location, length: 0 });
  }

  /// A key an input method composes first, like the backtick on a Brazilian
  /// keyboard: marked, then committed by the next key.
  typeWithDeadKey(key: string): void {
    this.setMarkedText(key);
    this.insertText(key);
  }

  /// EditorTextView.insertText: typing, keys and input methods alike.
  private insertText(typed: string, replacementRange: TextRange | null = null): void {
    const pairing = this.pairing(typed, replacementRange);
    if (pairing === null) {
      this.insertTextAsUsual(typed, replacementRange);
      return;
    }
    const { edit } = pairing;
    if (edit.range.length > 0 || edit.replacement !== "") {
      this.insertTextAsUsual(edit.replacement, edit.range);
    }
    this.setSelectedRange(edit.selection);
    if (pairing.opensPairAt !== null) this.pairs.opened(pairing.opensPairAt);
  }

  /// Coordinator.pairing(forTyping:replacementRange:).
  private pairing(typed: string, replacementRange: TextRange | null): Typing | null {
    const range = replacementRange ?? this.composing ?? this.selection;
    return typing(typed, range, this.composing !== null, this.text, this.pairs.innermost, () =>
      isInsideCode(this.text, range.location),
    );
  }

  /// NSTextView's own insertText, which asks the delegate first, replaces
  /// the marked text or the selection, and leaves the caret after it.
  private insertTextAsUsual(string: string, replacementRange: TextRange | null): void {
    const range = replacementRange ?? this.composing ?? this.selection;
    if (!this.shouldChangeText(range, string)) return;
    this.replaceCharacters(range, string);
    this.composing = null;
    this.setSelectedRange({ location: range.location + string.length, length: 0 });
  }

  /// Coordinator.textView(_:shouldChangeTextIn:replacementString:), undo aside.
  private shouldChangeText(range: TextRange, replacement: string): boolean {
    if (this.composing === null) {
      const arrow = substitution(this.text, range, replacement);
      if (arrow !== null && !isInsideCode(this.text, range.location)) {
        this.insertText(arrow.replacement, arrow.range);
        return false;
      }
    }
    this.pairs.textWillChange(range, replacement.length);
    return true;
  }

  /// Coordinator.handleDeleteBackward, which inserts its edit through the
  /// text view's insertText.
  private handleDeleteBackward(): boolean {
    if (this.composing !== null) return false;
    const edit = deletingBackward(this.selection, this.pairs.innermost);
    if (edit === null) return false;
    this.insertText(edit.replacement, edit.range);
    this.setSelectedRange(edit.selection);
    return true;
  }

  /// NSTextView's deleteBackward: the selection, or the character before the
  /// caret (one UTF-16 unit, as these tests type ASCII).
  private deleteBackwardAsUsual(): void {
    const { location, length } = this.selection;
    if (length === 0 && location === 0) return;
    const range = length > 0 ? this.selection : { location: location - 1, length: 1 };
    if (!this.shouldChangeText(range, "")) return;
    this.replaceCharacters(range, "");
    this.setSelectedRange({ location: range.location, length: 0 });
  }

  /// NSTextView.setMarkedText: what the input method composes goes in,
  /// marked, with the caret after it. It's a change like any other to the
  /// pairs; a composed character is never half of an arrow here.
  private setMarkedText(string: string): void {
    const range = this.composing ?? this.selection;
    this.pairs.textWillChange(range, string.length);
    this.replaceCharacters(range, string);
    this.composing = { location: range.location, length: string.length };
    this.setSelectedRange({ location: range.location + string.length, length: 0 });
  }

  /// Every selection change reaches Coordinator.textViewDidChangeSelection.
  private setSelectedRange(selection: TextRange): void {
    this.selection = selection;
    this.pairs.selectionDidChange(selection);
  }

  private replaceCharacters(range: TextRange, string: string): void {
    this.text = this.text.slice(0, range.location) + string + this.text.slice(maxRange(range));
  }
}

describe("AutoPairing typing", () => {
  const pairs: [string, string][] = [
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
    ['"', '"'],
    ["*", "*"],
    ["_", "_"],
    ["`", "`"],
  ];

  it.each(pairs)("an opening %s brings its closing %s", (open, close) => {
    const editor = new Editor();
    editor.type(open);
    expect(editor.state).toBe(open + "‸" + close);
  });

  it.each(pairs)("typing the closing character of %s%s steps over it", (open, close) => {
    const editor = new Editor();
    editor.type(open + "a" + close);
    expect(editor.state).toBe(open + "a" + close + "‸");
  });

  it("types bold and bold italic through", () => {
    const bold = new Editor();
    bold.type("**bold**");
    expect(bold.state).toBe("**bold**‸");

    const both = new Editor();
    both.type("***both***");
    expect(both.state).toBe("***both***‸");
  });

  it("types links and task lists through", () => {
    const link = new Editor();
    link.type("[text](https://example.com)");
    expect(link.state).toBe("[text](https://example.com)‸");

    const task = new Editor();
    task.type("- [ ] task");
    expect(task.state).toBe("- [ ] task‸");
  });

  /// A star followed by a space closes nothing: a list item, or arithmetic.
  it("closes nothing with a star and a space", () => {
    const list = new Editor();
    list.type("* item");
    expect(list.state).toBe("* item‸");

    const nested = new Editor("- first\n‸");
    nested.type("  * second");
    expect(nested.state).toBe("- first\n  * second‸");

    const arithmetic = new Editor();
    arithmetic.type("2 * 3");
    expect(arithmetic.state).toBe("2 * 3‸");
  });

  it("removes both characters when deleting into an empty pair", () => {
    const parens = new Editor();
    parens.type("(");
    parens.deleteBackward();
    expect(parens.state).toBe("‸");

    const bold = new Editor();
    bold.type("**");
    bold.deleteBackward();
    expect(bold.state).toBe("*‸*");
    bold.deleteBackward();
    expect(bold.state).toBe("‸");
  });

  it("keeps the pair while deleting what was typed inside, until it's empty", () => {
    const editor = new Editor();
    editor.type("(a");
    editor.deleteBackward();
    expect(editor.state).toBe("(‸)");
    editor.deleteBackward();
    expect(editor.state).toBe("‸");
  });

  it("wraps a selection it's typed over", () => {
    const bold = new Editor("«word»");
    bold.type("*");
    expect(bold.state).toBe("*«word»*");
    bold.type("*");
    expect(bold.state).toBe("**«word»**");

    const link = new Editor("see «this» page");
    link.type("[");
    expect(link.state).toBe("see [«this»] page");
  });

  /// Typed right before a word, the character is marking it by hand.
  it.each(["(", "[", '"', "*", "_", "`"])("pairs nothing right before a word: %s", (opener) => {
    const editor = new Editor("‸word");
    editor.type(opener);
    expect(editor.state).toBe(opener + "‸word");
  });

  /// After a letter or a digit, a quote or a marker closes something.
  it("closes rather than opens with a quote or a marker after a word", () => {
    const snake = new Editor();
    snake.type("snake_case");
    expect(snake.state).toBe("snake_case‸");

    const inches = new Editor();
    inches.type('5"');
    expect(inches.state).toBe('5"‸');

    const italic = new Editor("*word‸");
    italic.type("*");
    expect(italic.state).toBe("*word*‸");
  });

  it("still pairs brackets after a word", () => {
    const editor = new Editor();
    editor.type("f(");
    expect(editor.state).toBe("f(‸)");
  });

  it("doesn't pair an escaped character", () => {
    const editor = new Editor();
    editor.type("\\*");
    expect(editor.state).toBe("\\*‸");
  });

  /// In code, Markdown's markers are plain characters; brackets still pair.
  it("pairs brackets but not markers in code blocks", () => {
    const editor = new Editor("```\n‸\n```");
    editor.type("*");
    expect(editor.state).toBe("```\n*‸\n```");
    editor.type("(");
    expect(editor.state).toBe("```\n*(‸)\n```");
  });

  it("closes inline code without pairing inside it", () => {
    const editor = new Editor();
    editor.type("`");
    editor.type("a*b");
    expect(editor.state).toBe("`a*b‸`");
    editor.type("`");
    expect(editor.state).toBe("`a*b`‸");
  });

  /// Only a closing character the editor typed is stepped over.
  it("keeps a closing character typed by hand", () => {
    const editor = new Editor("(a‸)");
    editor.type(")");
    expect(editor.state).toBe("(a)‸)");
  });

  it("makes a pair the writer's own once the caret leaves it", () => {
    const editor = new Editor();
    editor.type("(");
    editor.moveCaret(0);
    editor.moveCaret(1);
    editor.type(")");
    expect(editor.state).toBe("()‸)");
  });

  /// On a Brazilian keyboard the backtick is a dead key: it arrives
  /// composed, and still opens and closes inline code.
  it("pairs and closes a backtick that comes from a dead key", () => {
    const editor = new Editor();
    editor.typeWithDeadKey("`");
    expect(editor.state).toBe("`‸`");
    editor.type("code");
    editor.typeWithDeadKey("`");
    expect(editor.state).toBe("`code`‸");
  });

  it("still turns -> into an arrow", () => {
    const editor = new Editor();
    editor.type("a -> b");
    expect(editor.state).toBe("a → b‸");
  });

  /// The Coordinator keeps arrows out of code, where `->` is meant literally.
  it("leaves arrows alone in code", () => {
    const editor = new Editor();
    editor.type("`a->b");
    expect(editor.state).toBe("`a->b‸`");
  });
});

describe("OpenPairs", () => {
  it("moves a pair with text typed before and inside it", () => {
    const pairs = new OpenPairs();
    pairs.opened(4);
    pairs.textWillChange({ location: 5, length: 0 }, 3);
    expect(pairs.innermost).toEqual({ opener: 4, closer: 8 });
    pairs.textWillChange({ location: 0, length: 0 }, 2);
    expect(pairs.innermost).toEqual({ opener: 6, closer: 10 });
  });

  it("leaves a pair where it is for text after it", () => {
    const pairs = new OpenPairs();
    pairs.opened(4);
    pairs.textWillChange({ location: 6, length: 0 }, 3);
    expect(pairs.innermost).toEqual({ opener: 4, closer: 5 });
  });

  it.each([
    { location: 4, length: 1 },
    { location: 5, length: 1 },
    { location: 2, length: 6 },
  ])("ends the pair with an edit taking either character: %o", (range) => {
    const pairs = new OpenPairs();
    pairs.opened(4);
    pairs.textWillChange(range, 0);
    expect(pairs.innermost).toBeNull();
  });

  it("ends the pair with a caret outside it", () => {
    const pairs = new OpenPairs();
    pairs.opened(4);
    pairs.selectionDidChange({ location: 5, length: 0 });
    expect(pairs.innermost).not.toBeNull();
    pairs.selectionDidChange({ location: 4, length: 0 });
    expect(pairs.innermost).toBeNull();

    pairs.opened(4);
    pairs.selectionDidChange({ location: 6, length: 0 });
    expect(pairs.innermost).toBeNull();
  });

  it("keeps the outer pair when leaving an inner one", () => {
    const pairs = new OpenPairs();
    pairs.opened(0);
    pairs.textWillChange({ location: 1, length: 0 }, 2);
    pairs.opened(1);
    expect(pairs.innermost).toEqual({ opener: 1, closer: 2 });
    pairs.selectionDidChange({ location: 3, length: 0 });
    expect(pairs.innermost).toEqual({ opener: 0, closer: 3 });
  });
});
