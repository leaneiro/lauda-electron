/// A message box's options as its system shows them best. GTK centres a
/// message box's text, and GNOME's own alerts have no icon, so on Linux the
/// icon Electron would set beside the centred text, where it reads as
/// misaligned, is left out. Windows and macOS set their text beside their
/// icons, and keep them.
export function messageOptionsFor<T extends { type?: string }>(options: T, platform: string): T {
  return platform === "linux" ? { ...options, type: "none" } : options;
}
