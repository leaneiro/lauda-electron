import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import app from "../../resources/locales/app.json";
import { supportedLocales } from "../../src/shared/i18n";

const root = join(__dirname, "../..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const description: string = pkg.description;
const translations = (app.strings as Record<string, Record<string, string>>)[description] ?? {};

/// Each language the app speaks, as the Windows installer (a Windows
/// language code) and a Linux desktop entry (a locale suffix) name it.
const windowsLanguage: Record<string, number> = {
  en: 1033,
  "pt-BR": 1046,
  de: 1031,
  es: 3082,
  fr: 1036,
  ja: 1041,
  "zh-Hans": 2052,
};
const desktopLocale: Record<string, string> = {
  "pt-BR": "pt_BR",
  de: "de",
  es: "es",
  fr: "fr",
  ja: "ja",
  "zh-Hans": "zh_CN",
};

/// The app's description reaches the reader outside the app: the tooltip of
/// a Windows shortcut, the comment of a Linux desktop entry. Both come from
/// the catalog's translations, in every language the app speaks.
describe("the app's description outside the app", () => {
  it("is in the catalog in every language", () => {
    expect(Object.keys(translations).sort()).toEqual([...supportedLocales].sort());
  });

  it("is the Windows shortcuts' tooltip in the installer's language", () => {
    const script = readFileSync(join(root, "build/installer.nsh"), "utf8");
    const written = Object.fromEntries(
      [...script.matchAll(/^LangString laudaDescription (\d+) "(.*)"$/gm)].map(([, id, text]) => [Number(id), text]),
    );
    const expected = Object.fromEntries(
      supportedLocales.map((locale) => [windowsLanguage[locale], translations[locale]]),
    );
    expect(written).toEqual(expected);
  });

  it("gives the Windows installer the app's languages and no others", () => {
    expect(pkg.build.nsis.installerLanguages).toEqual(["en_US", "pt_BR", "de_DE", "es_ES", "fr_FR", "ja_JP", "zh_CN"]);
  });

  it("is the Linux desktop entry's comment in each language", () => {
    const entry: Record<string, string> = pkg.build.linux.desktop.entry;
    for (const locale of supportedLocales.filter((locale) => locale !== "en")) {
      expect(entry[`Comment[${desktopLocale[locale]}]`], locale).toBe(translations[locale]);
    }
  });
});
