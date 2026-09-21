import type { LaudaAPI } from "../preload/bridge";
import { type Locale, Strings, type TranslationKey } from "../shared/i18n";
import type { Platform } from "../shared/ipc";
import { DocumentWorker } from "./worker-client";

declare global {
  interface Window {
    lauda: LaudaAPI;
  }
}

/// What the window's parts reach outside themselves for: the main process,
/// the reader's language and the system the window runs on. Made once at
/// startup and handed to each part, so a test can hand in its own.
export class WindowContext {
  private documentWorker: DocumentWorker | undefined;

  constructor(
    /// The main process, through the preload script's bridge.
    readonly lauda: LaudaAPI,
    readonly strings: Strings,
    readonly platform: Platform,
  ) {}

  /// The context of a window the main process described.
  static of(lauda: LaudaAPI, state: { platform: Platform; locale: Locale }): WindowContext {
    return new WindowContext(lauda, new Strings(state.locale, state.platform === "darwin"), state.platform);
  }

  /// The worker that renders and counts the window's documents, started
  /// when first asked for.
  get worker(): DocumentWorker {
    this.documentWorker ??= new DocumentWorker(this.lauda);
    return this.documentWorker;
  }

  get isMac(): boolean {
    return this.platform === "darwin";
  }

  /// The localized string for an English key (see shared/i18n).
  readonly t = (key: TranslationKey, ...args: (string | number)[]): string => this.strings.t(key, ...args);

  /// A shortcut as the platform writes it: ⇧⌘G on a Mac, Ctrl+Shift+G elsewhere.
  shortcut(key: string, shift = false): string {
    if (this.isMac) return `${shift ? "⇧" : ""}⌘${key}`;
    return `Ctrl+${shift ? "Shift+" : ""}${key}`;
  }
}

/// The page takes the reader's language, and the look of the system it
/// runs on.
export function dressPage(context: WindowContext): void {
  document.documentElement.lang = context.strings.locale;
  document.body.classList.add(`platform-${context.platform}`);
}
