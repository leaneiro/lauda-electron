/// Light or dark, as the system (or Settings) says; the preview follows on
/// its own through prefers-color-scheme.
export function followTheme(): void {
  const dark = matchMedia("(prefers-color-scheme: dark)");
  const apply = () => (document.documentElement.dataset.theme = dark.matches ? "dark" : "light");
  dark.addEventListener("change", apply);
  apply();
}
