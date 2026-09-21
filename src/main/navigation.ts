import { type App, BrowserWindow, Menu } from "electron";
import type { Strings } from "../shared/i18n";
import { mayFrameNavigate } from "../shared/navigation";
import { appOrigin } from "./protocols";

/// Every page the app opens gets the same guard: nothing navigates away
/// (mayFrameNavigate decides what a frame may load), no page opens a window,
/// and editable text answers a secondary click with the menu a text view
/// has. Links leave the app through the preview's script, in the browser.
export function guardPages(app: App, context: { strings: () => Strings; window: () => BrowserWindow | null }): void {
  app.on("web-contents-created", (_event, contents) => {
    contents.on("context-menu", (_menuEvent, params) => {
      if (!params.isEditable && !params.selectionText) return;
      const strings = context.strings();
      const t = strings.t.bind(strings);
      const menu = Menu.buildFromTemplate(
        params.isEditable
          ? [
              { label: t("Cut"), role: "cut", enabled: params.editFlags.canCut },
              { label: t("Copy"), role: "copy", enabled: params.editFlags.canCopy },
              { label: t("Paste"), role: "paste", enabled: params.editFlags.canPaste },
              { type: "separator" },
              { label: t("Select All"), role: "selectAll" },
            ]
          : [{ label: t("Copy"), role: "copy" }],
      );
      const window = BrowserWindow.fromWebContents(contents) ?? context.window();
      if (window) menu.popup({ window });
    });
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-navigate", (event) => event.preventDefault());
    contents.on("will-frame-navigate", (event) => {
      const navigation = {
        url: event.url,
        isMainFrame: event.isMainFrame,
        parentURL: event.frame?.parent?.url ?? null,
      };
      if (!mayFrameNavigate(navigation, appOrigin)) event.preventDefault();
    });
  });
}
