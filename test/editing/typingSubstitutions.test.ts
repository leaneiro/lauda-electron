import { describe, expect, it } from "vitest";
import { substitution } from "../../src/shared/editing";

function substitute(text: string, typing: string, location: number) {
  return substitution(text, { location, length: 0 }, typing);
}

describe("TypingSubstitutions", () => {
  it("turns -> into a right arrow", () => {
    const result = substitute("a -", ">", 3);
    expect(result?.range).toEqual({ location: 2, length: 1 });
    expect(result?.replacement).toBe("→");
  });

  it("turns <- into a left arrow", () => {
    const result = substitute("a <", "-", 3);
    expect(result?.range).toEqual({ location: 2, length: 1 });
    expect(result?.replacement).toBe("←");
  });

  it("substitutes nothing without the prior character", () => {
    expect(substitute("abc", ">", 3)).toBeNull();
    expect(substitute("", ">", 0)).toBeNull();
  });

  it("leaves a plain dash untouched", () => {
    expect(substitute("a b", "-", 3)).toBeNull();
  });
});
