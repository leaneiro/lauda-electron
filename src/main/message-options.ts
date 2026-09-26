/// A message box's options as its system shows them best. On Linux and
/// Windows the icon Electron would set beside the text is left out: GTK
/// centres the text, where an icon beside it reads as misaligned, and GNOME's
/// own alerts have none; on Windows it was a choice from the test run, the
/// blue title saying it on its own. macOS keeps its icon.
export function messageOptionsFor<T extends { type?: string }>(options: T, platform: string): T {
  return platform === "darwin" ? options : { ...options, type: "none" };
}
