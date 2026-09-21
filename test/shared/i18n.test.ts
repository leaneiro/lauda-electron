import { describe, expect, test } from "vitest";
import { pickLocale, Strings } from "../../src/shared/i18n";

describe("pickLocale", () => {
  test.each([
    [["pt-BR"], "pt-BR"],
    [["pt-PT"], "pt-BR"],
    [["pt"], "pt-BR"],
    [["de-CH", "en"], "de"],
    [["zh-Hans-CN"], "zh-Hans"],
    [["zh-CN"], "zh-Hans"],
    [["zh-TW", "fr"], "fr"],
    [["zh-Hant", "ja-JP"], "ja"],
    [["ko", "es-MX"], "es"],
    [["ko"], "en"],
    [[], "en"],
  ])("%j reads %s", (preferred, expected) => {
    expect(pickLocale(preferred)).toBe(expected);
  });
});

describe("Strings", () => {
  test("plurals follow the language, and a catalog's zero form wins", () => {
    const portuguese = new Strings("pt-BR", true);
    expect(portuguese.t("%lld words", 0)).toBe("0 palavras");
    expect(portuguese.t("%lld words", 1)).toBe("1 palavra");
    expect(portuguese.t("%lld words", 2)).toBe("2 palavras");
    const english = new Strings("en", true);
    expect(english.t("%lld words", 1)).toBe("1 word");
    expect(english.t("%lld words", 3)).toBe("3 words");
  });

  test("numbers are grouped as the language writes them", () => {
    expect(new Strings("pt-BR", true).t("%lld characters", 1852)).toBe("1.852 caracteres");
    expect(new Strings("en", true).t("%lld characters", 1852)).toBe("1,852 characters");
  });

  test("arguments fill in order", () => {
    expect(new Strings("pt-BR", true).t("Text width: %@. Next: %@", "Normal", "Média")).toBe(
      "Largura do texto: Normal. Próxima: Média",
    );
  });

  test("a missing key reads as itself", () => {
    expect(new Strings("fr", true).t("Nothing like this")).toBe("Nothing like this");
  });

  test("German says speichern outside the Mac", () => {
    expect(new Strings("de", true).t("Save")).toBe("Sichern");
    expect(new Strings("de", false).t("Save")).toBe("Speichern");
  });

  test("the app's own strings exist in every language", async () => {
    const app = (await import("../../resources/locales/app.json")).default as {
      strings: Record<string, Record<string, string>>;
    };
    for (const [key, translations] of Object.entries(app.strings)) {
      for (const locale of ["en", "pt-BR", "de", "es", "fr", "ja", "zh-Hans"]) {
        expect(translations[locale], `${key} in ${locale}`).toBeTruthy();
        expect(translations[locale], `${key} in ${locale}`).not.toContain("—");
      }
    }
  });
});
