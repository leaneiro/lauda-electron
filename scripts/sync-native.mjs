// Brings over what the native app and this one share, so the two stay in
// step: the string catalog (converted to JSON, plural variations kept), the
// preview's stylesheet and wordmark font, the welcome guides and the icons.
// Run it after changing any of them in the native repository.
import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const native = process.env.LAUDA_NATIVE ?? join(root, "..", "markeditor");

function copy(from, to) {
  mkdirSync(dirname(join(root, to)), { recursive: true });
  cpSync(join(native, from), join(root, to), { recursive: true });
}

// Strings: { key: { locale: value } }, where a value is a string or, for a
// plural, { zero?, one?, few?, many?, other }.
const catalog = JSON.parse(readFileSync(join(native, "Resources/Localizable.xcstrings"), "utf8"));
const strings = {};
for (const [key, entry] of Object.entries(catalog.strings)) {
  const out = {};
  for (const [locale, localization] of Object.entries(entry.localizations ?? {})) {
    if (localization.stringUnit) {
      out[locale] = localization.stringUnit.value;
    } else if (localization.variations?.plural) {
      const forms = {};
      for (const [form, variation] of Object.entries(localization.variations.plural)) {
        forms[form] = variation.stringUnit.value;
      }
      out[locale] = forms;
    }
  }
  strings[key] = out;
}
mkdirSync(join(root, "resources/locales"), { recursive: true });
writeFileSync(join(root, "resources/locales/native.json"), `${JSON.stringify(strings, null, 2)}\n`);

copy("Sources/Lauda/Preview/preview.css", "resources/preview/preview.css");
copy("Sources/Lauda/Preview/LaudaWordmark.woff", "resources/preview/LaudaWordmark.woff");
copy("Sources/Lauda/Preview/Newsreader-OFL.txt", "resources/preview/Newsreader-OFL.txt");

for (const folder of readdirSync(join(native, "Resources/Welcome"))) {
  if (!folder.endsWith(".lproj")) continue;
  const language = folder.replace(/\.lproj$/, "");
  copy(`Resources/Welcome/${folder}/Welcome.md`, `resources/welcome/${language}.md`);
}

for (const icon of readdirSync(join(native, "Resources/Icons"))) {
  if (/^AppIcon.*\.(png|svg)$/.test(icon)) {
    copy(`Resources/Icons/${icon}`, `resources/icons/${icon}`);
  }
}

console.log(`OK: ${Object.keys(strings).length} strings, preview files, welcome guides and icons from ${native}`);
