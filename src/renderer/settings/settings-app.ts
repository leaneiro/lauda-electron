import { type AppearanceMode, appearanceModes, limits, type Settings, specialFontOptions } from "../../shared/settings";
import { ChoiceGroup } from "../choice-group";
import { dressPage, WindowContext } from "../context";
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
function fontPicker(
  value: string,
  families: readonly string[],
  t: WindowContext["t"],
  onChange: (font: string) => void,
): HTMLSelectElement {
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

/// The font families installed on this computer, as the system lists them
/// to the page (the Local Font Access API), sorted as the native app sorts
/// them. Hidden system faces, whose names start with a dot, are left out,
/// as on the Mac. Without the API, or its permission, the pickers keep the
/// special fonts.
async function installedFontFamilies(): Promise<string[]> {
  const query = (window as Window & { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts;
  let faces: { family: string }[] = [];
  try {
    faces = (await query?.()) ?? [];
  } catch {
    return [];
  }
  const families = new Set(faces.map((face) => face.family.trim()).filter((name) => name && !name.startsWith(".")));
  return [...families].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
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
  /// Kept from one drawing of the form to the next, so the keyboard stays
  /// on it while the arrows choose.
  private readonly appearance: ChoiceGroup<AppearanceMode>;

  constructor(
    private readonly context: WindowContext,
    private readonly form: HTMLFormElement,
    private settings: Settings,
  ) {
    const { t } = context;
    const labels = { auto: "Automatic", light: "Light", dark: "Dark" } as const;
    this.appearance = new ChoiceGroup(
      "segmented",
      t("Appearance"),
      appearanceModes.map((mode) => ({ value: mode, label: t(labels[mode]) })),
      (mode) => {
        this.set({ appearanceMode: mode });
        this.appearance.show(mode);
      },
    );
    form.addEventListener("submit", (event) => event.preventDefault());
    this.render();
  }

  /// Settings stored from anywhere, this form included. What arrives while
  /// one of the form's controls has the focus (a slider, the checkbox, a
  /// choice) is the form's own change, which it already shows, and drawing
  /// the form again would take the control from under the pointer or the
  /// keyboard. Restore Defaults is a plain button, and takes the focus when
  /// pressed.
  settingsChanged(settings: Settings): void {
    this.settings = settings;
    const focused = document.activeElement;
    if (focused?.tagName !== "INPUT" && focused?.getAttribute("role") !== "radio") this.render();
  }

  fontsListed(families: readonly string[]): void {
    this.fontFamilies = families;
    this.render();
  }

  private set(changes: Partial<Settings>): void {
    this.settings = { ...this.settings, ...changes };
    void this.context.lauda.invoke("settings:set", changes);
  }

  private render(): void {
    const { lauda, t, strings } = this.context;
    const current = this.settings;
    this.appearance.show(current.appearanceMode);

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
      ...section(t("General"), [row(t("Appearance"), this.appearance.element)]),
      ...section(t("Editor"), [
        row(
          t("Font"),
          fontPicker(current.editorFontName, families, t, (font) => this.set({ editorFontName: font })),
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
          fontPicker(current.previewFontName, families, t, (font) => this.set({ previewFontName: font })),
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
            (value) => formatLineHeight(value, strings.locale),
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
  const lauda = window.lauda;
  const state = await lauda.invoke("app:init");
  const context = WindowContext.of(lauda, state);
  dressPage(context);
  followTheme();
  document.title = context.t("Settings");
  const form = new SettingsForm(context, document.getElementById("settings") as HTMLFormElement, state.settings);
  lauda.on("settings:changed", (settings) => form.settingsChanged(settings));
  form.fontsListed(await installedFontFamilies());
}

void start();
