import type { LaudaAPI } from "../preload/bridge";
import { Strings, type Locale } from "../shared/i18n";
import type { InitialState, Platform } from "../shared/ipc";

declare global {
  interface Window {
    lauda: LaudaAPI;
  }
}

/// The main process, through the preload script's bridge.
export const lauda = window.lauda;

let current: Strings = new Strings("en", true);
let platformName: Platform = "darwin";

export function configure(state: InitialState): void {
  platformName = state.platform;
  current = new Strings(state.locale as Locale, state.platform === "darwin");
  document.documentElement.lang = state.locale;
  document.body.classList.add(`platform-${state.platform}`);
}

/// The localized string for an English key (see shared/i18n).
export function t(key: string, ...args: (string | number)[]): string {
  return current.t(key, ...args);
}

export function strings(): Strings {
  return current;
}

export function platform(): Platform {
  return platformName;
}

export const isMac = () => platformName === "darwin";

/// A shortcut as the platform writes it: ⇧⌘G on a Mac, Ctrl+Shift+G elsewhere.
export function shortcut(key: string, shift = false): string {
  if (isMac()) return `${shift ? "⇧" : ""}⌘${key}`;
  return `Ctrl+${shift ? "Shift+" : ""}${key}`;
}
