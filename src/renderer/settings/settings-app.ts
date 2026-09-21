import { appearanceModes, limits, type Settings, specialFontOptions } from "../../shared/settings";
import { configure, lauda, strings, t } from "../api";
import { element } from "../dom";
import { followTheme } from "../theme";

function section(title: string, rows: HTMLElement[]): HTMLElement[] {
  const card = element("div", "card");
  card.append(...rows);
  return [element("div", "section-title", title), card];
}

function row(label: string | HTMLElement, ...controls: HTMLElement[]): HTMLElement {
  const container = element("div", "row");
  container.append(typeof label === "string" ? element("span", "label", label) : label, ...controls);
  return container;
}

/// The special fonts first, then the system's, a line between them.
function fontPicker(value: string, families: readonly string[], onChange: (font: string) => void): HTMLSelectElement {
  const select = element("select");
  for (const option of specialFontOptions) select.append(new Option(t(option.key), option.id));
  select.append(element("hr"));
  for (const family of families) select.append(new Option(family, family));
  if (!select.querySelector(`option[value="${CSS.escape(value)}"]`)) select.append(new Option(value, value));
  select.value = value;
  select.addEventListener("change", () => onChange(select.value));
  return select;
}

function slider(
  value: number,
  range: { min: number; max: number; step: number },
  format: (value: number) => string,
  onChange: (value: number) => void,
): HTMLElement[] {
  const input = element("input");
  input.type = "range";
  input.min = String(range.min);
  input.max = String(range.max);
  input.step = String(range.step);
  input.value = String(value);
  const shown = element("span", "value", format(value));
  input.addEventListener("input", () => {
    const next = Math.round(Number(input.value) / range.step) * range.step;
    shown.textContent = format(next);
    onChange(Number(next.toFixed(2)));
  });
  return [input, shown];
}

/// The line height with two decimals, as the language writes numbers.
function formatLineHeight(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

/// The Settings window (SettingsView.swift): General, Editor and Preview,
/// then Restore Defaults. Every change is stored at once and every window
/// follows it.
class SettingsForm {
  private fontFamilies: readonly string[] = [];

  constructor(
    private readonly form: HTMLFormElement,
    private settings: Settings,
  ) {
    form.addEventListener("submit", (event) => event.preventDefault());
    this.render();
  }

  /// Settings stored from anywhere, this form included. What arrives while
  /// a slider or the checkbox has the focus is the form's own change, which
  /// it already shows, and drawing the form again would take the control
  /// from under the pointer. Restore Defaults is a button, and takes the
  /// focus when pressed.
  settingsChanged(settings: Settings): void {
    this.settings = settings;
    if (document.activeElement?.tagName !== "INPUT") this.render();
  }

  fontsListed(families: readonly string[]): void {
    this.fontFamilies = families;
    this.render();
  }

  private set(changes: Partial<Settings>): void {
    this.settings = { ...this.settings, ...changes };
    void lauda.invoke("settings:set", changes);
  }

  private render(): void {
    const current = this.settings;
    const appearance = element("div", "segmented");
    appearance.setAttribute("role", "group");
    appearance.setAttribute("aria-label", t("Appearance"));
    const labels = { auto: "Automatic", light: "Light", dark: "Dark" } as const;
    for (const mode of appearanceModes) {
      const button = element("button", undefined, t(labels[mode]));
      button.type = "button";
      button.setAttribute("aria-pressed", String(current.appearanceMode === mode));
      button.addEventListener("click", () => {
        this.set({ appearanceMode: mode });
        this.render();
      });
      appearance.append(button);
    }

    const points = (value: number) => t("%lld pt", Math.round(value));
    const strict = element("input");
    strict.type = "checkbox";
    strict.checked = current.strictLineBreaks;
    strict.addEventListener("change", () => this.set({ strictLineBreaks: strict.checked }));
    const strictLabel = element("label", "label");
    strictLabel.append(
      t("Strict line breaks"),
      element("small", undefined, t("A single Return doesn't break the line, as in standard Markdown.")),
    );
    strictLabel.addEventListener("click", (event) => {
      event.preventDefault();
      strict.click();
    });

    const restore = element("div", "restore");
    const restoreButton = element("button", undefined, t("Restore Defaults"));
    restoreButton.type = "button";
    restoreButton.addEventListener("click", () => void lauda.invoke("settings:restore-defaults"));
    restore.append(restoreButton);

    const families = this.fontFamilies;
    this.form.replaceChildren(
      ...section(t("General"), [row(t("Appearance"), appearance)]),
      ...section(t("Editor"), [
        row(
          t("Font"),
          fontPicker(current.editorFontName, families, (font) => this.set({ editorFontName: font })),
        ),
        row(
          t("Size"),
          ...slider(current.editorFontSize, limits.editorFontSize, points, (size) =>
            this.set({ editorFontSize: size }),
          ),
        ),
      ]),
      ...section(t("Preview"), [
        row(
          t("Font"),
          fontPicker(current.previewFontName, families, (font) => this.set({ previewFontName: font })),
        ),
        row(
          t("Size"),
          ...slider(current.previewFontSize, limits.previewFontSize, points, (size) =>
            this.set({ previewFontSize: size }),
          ),
        ),
        row(
          t("Line height"),
          ...slider(
            current.previewLineHeight,
            limits.previewLineHeight,
            (value) => formatLineHeight(value, strings().locale),
            (value) => this.set({ previewLineHeight: value }),
          ),
        ),
        row(strictLabel, strict),
      ]),
      restore,
    );
    void lauda.invoke("settings:fit-window", this.form.getBoundingClientRect().height);
  }
}

async function start(): Promise<void> {
  const state = await lauda.invoke("app:init");
  configure(state);
  followTheme();
  document.title = t("Settings");
  const form = new SettingsForm(document.getElementById("settings") as HTMLFormElement, state.settings);
  lauda.on("settings:changed", (settings) => form.settingsChanged(settings));
  form.fontsListed(await lauda.invoke("app:list-fonts"));
}

void start();
