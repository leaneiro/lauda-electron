import app from "../../resources/locales/app.json";
import native from "../../resources/locales/native.json";

/// The languages the app speaks. English is the base; Brazilian Portuguese
/// is reviewed; the others are drafts, as in the native app.
export const supportedLocales = ["en", "pt-BR", "de", "es", "fr", "ja", "zh-Hans"] as const;
export type Locale = (typeof supportedLocales)[number];

/// A key of the string catalogs: the native app's, and this edition's own.
/// A key that is in neither doesn't compile, rather than showing English.
export type TranslationKey = keyof typeof native | keyof typeof app.strings;

type PluralForms = Partial<Record<"zero" | "one" | "two" | "few" | "many" | "other", string>>;
type Entry = Record<string, string | PluralForms>;

const nativeStrings = native as Record<string, Entry>;
const appStrings = app.strings as Record<string, Entry>;
const outsideMac = app.outsideMac as Record<string, Record<string, string>>;

/// The first of the system's preferred languages the app speaks, the way
/// macOS picks a bundle localization: an exact match, then the language
/// alone (pt-PT reads Brazilian Portuguese, any Chinese but Traditional
/// reads Simplified), then English.
export function pickLocale(preferred: readonly string[]): Locale {
  for (const tag of preferred) {
    const normalized = tag.replace("_", "-");
    const exact = supportedLocales.find((l) => l.toLowerCase() === normalized.toLowerCase());
    if (exact) return exact;
    const [language = "", ...rest] = normalized.split("-");
    const lower = language.toLowerCase();
    if (lower === "zh") {
      const region = rest.join("-").toLowerCase();
      if (/hant|tw|hk|mo/.test(region)) continue;
      return "zh-Hans";
    }
    if (lower === "pt") return "pt-BR";
    const byLanguage = supportedLocales.find((l) => (l.split("-")[0] ?? "").toLowerCase() === lower);
    if (byLanguage) return byLanguage;
  }
  return "en";
}

/// Localized strings, looked up by their English key as in the native
/// string catalog.
export class Strings {
  private readonly numbers: Intl.NumberFormat;
  private readonly plurals: Intl.PluralRules;

  constructor(
    readonly locale: Locale,
    private readonly isMac: boolean,
  ) {
    this.numbers = new Intl.NumberFormat(locale);
    this.plurals = new Intl.PluralRules(locale);
  }

  /// The string for `key`, with `%@` and `%lld` filled in from `args` in
  /// order (`%1$@` picks one by position). A key with plural variations
  /// chooses its form from the first number argument.
  t(key: TranslationKey, ...args: (string | number)[]): string {
    const value = this.lookup(key);
    const template = typeof value === "string" ? value : this.pluralForm(value, args);
    return format(template, args, this.numbers);
  }

  /// The number as the language writes it (1.852 in Portuguese).
  number(value: number): string {
    return this.numbers.format(value);
  }

  private lookup(key: TranslationKey): string | PluralForms {
    if (!this.isMac) {
      const override = outsideMac[this.locale]?.[key];
      if (override) return override;
    }
    const entry = appStrings[key] ?? nativeStrings[key];
    return entry?.[this.locale] ?? entry?.en ?? key;
  }

  /// String catalogs may give zero a form of its own, whatever the
  /// language's plural rules say about it (Portuguese counts 0 as singular).
  private pluralForm(forms: PluralForms, args: (string | number)[]): string {
    const count = args.find((arg): arg is number => typeof arg === "number") ?? 0;
    if (count === 0 && forms.zero) return forms.zero;
    const category = this.plurals.select(count) as keyof PluralForms;
    return forms[category] ?? forms.other ?? Object.values(forms)[0] ?? "";
  }
}

function format(template: string, args: (string | number)[], numbers: Intl.NumberFormat): string {
  let next = 0;
  return template.replace(/%(?:(\d+)\$)?(@|lld|ld|d|%)/g, (match, position: string | undefined, kind: string) => {
    if (kind === "%") return "%";
    const index = position ? Number(position) - 1 : next++;
    const arg = args[index];
    if (arg === undefined) return match;
    return typeof arg === "number" ? numbers.format(arg) : arg;
  });
}
