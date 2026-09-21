import { configure, lauda, t } from "../api";
import { followTheme } from "../theme";
import { appearanceModes, limits, specialFontOptions, type Settings } from "../../shared/settings";

/// The Settings window (SettingsView.swift): General, Editor and Preview,
/// then Restore Defaults. Every change is stored at once and every window
/// follows it.

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

let current: Settings;
let fontFamilies: string[] = [];
const form = document.getElementById("settings") as HTMLFormElement;

function set(changes: Partial<Settings>): void {
  current = { ...current, ...changes };
  void lauda.invoke("settings:set", changes);
}

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

function fontPicker(value: string, onChange: (font: string) => void): HTMLSelectElement {
  const select = element("select");
  for (const option of specialFontOptions) select.append(new Option(t(option.key), option.id));
  const divider = new Option("──────────", "");
  divider.disabled = true;
  select.append(divider);
  for (const family of fontFamilies) select.append(new Option(family, family));
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

function render(): void {
  const appearance = element("div", "segmented");
  appearance.setAttribute("role", "group");
  appearance.setAttribute("aria-label", t("Appearance"));
  const labels = { auto: "Automatic", light: "Light", dark: "Dark" } as const;
  for (const mode of appearanceModes) {
    const button = element("button", undefined, t(labels[mode]));
    button.type = "button";
    button.setAttribute("aria-pressed", String(current.appearanceMode === mode));
    button.addEventListener("click", () => {
      set({ appearanceMode: mode });
      render();
    });
    appearance.append(button);
  }

  const points = (value: number) => t("%lld pt", Math.round(value));
  const strict = element("input");
  strict.type = "checkbox";
  strict.checked = current.strictLineBreaks;
  strict.addEventListener("change", () => set({ strictLineBreaks: strict.checked }));
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

  form.replaceChildren(
    ...section(t("General"), [row(t("Appearance"), appearance)]),
    ...section(t("Editor"), [
      row(
        t("Font"),
        fontPicker(current.editorFontName, (font) => set({ editorFontName: font })),
      ),
      row(
        t("Size"),
        ...slider(current.editorFontSize, limits.editorFontSize, points, (size) => set({ editorFontSize: size })),
      ),
    ]),
    ...section(t("Preview"), [
      row(
        t("Font"),
        fontPicker(current.previewFontName, (font) => set({ previewFontName: font })),
      ),
      row(
        t("Size"),
        ...slider(current.previewFontSize, limits.previewFontSize, points, (size) => set({ previewFontSize: size })),
      ),
      row(
        t("Line height"),
        ...slider(
          current.previewLineHeight,
          limits.previewLineHeight,
          (value) => strings2(value),
          (value) => set({ previewLineHeight: value }),
        ),
      ),
      row(strictLabel, strict),
    ]),
    restore,
  );
  void lauda.invoke("settings:fit-window", form.getBoundingClientRect().height);
}

/// The line height with two decimals, as the language writes numbers.
function strings2(value: number): string {
  return new Intl.NumberFormat(document.documentElement.lang || "en", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

async function start(): Promise<void> {
  const state = await lauda.invoke("app:init");
  configure(state);
  followTheme();
  document.title = t("Settings");
  current = state.settings;
  render();
  lauda.on("settings:changed", (settings) => {
    const restored = JSON.stringify(settings) !== JSON.stringify({ ...current, ...settings });
    current = settings;
    if (restored || document.activeElement?.tagName !== "INPUT") render();
  });
  fontFamilies = await lauda.invoke("app:list-fonts");
  render();
}

void start();
