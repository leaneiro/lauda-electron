import { Menu, type MenuItemConstructorOptions } from "electron";
import { basename } from "node:path";
import type { Strings } from "../shared/i18n";
import type { MenuCommand, MenuState } from "../shared/ipc";

export interface MenuContext {
  strings: Strings;
  isMac: boolean;
  isWindows: boolean;
  recentFiles: readonly string[];
  state: MenuState;
  send: (command: MenuCommand) => void;
  open: () => void;
  openRecent: (filePath: string) => void;
  clearRecent: () => void;
  showSettings: () => void;
  showWelcomeGuide: () => void;
  showAbout: () => void;
}

/// The menus of the native app (Commands.swift), with each platform's own
/// places for About, Settings and Quit.
export function buildMenu(context: MenuContext): Menu {
  const { strings, isMac, isWindows, state, send } = context;
  const t = strings.t.bind(strings);
  const hasDocument = state.hasDocument;
  const hasFile = state.hasFile;
  const command = (name: MenuCommand["name"]) => () => send({ name } as MenuCommand);

  const recent: MenuItemConstructorOptions[] = context.recentFiles.map((filePath) => ({
    label: basename(filePath),
    click: () => context.openRecent(filePath),
  }));
  if (recent.length > 0) recent.push({ type: "separator" });
  recent.push({ label: t("Clear Menu"), click: context.clearRecent, enabled: context.recentFiles.length > 0 });

  const file: MenuItemConstructorOptions = {
    label: t("File"),
    submenu: [
      { label: t("New"), accelerator: "CmdOrCtrl+N", click: command("new") },
      { label: t("Open…"), accelerator: "CmdOrCtrl+O", click: context.open },
      { label: t("Open Recent"), submenu: recent },
      { type: "separator" },
      { label: t("Close"), accelerator: "CmdOrCtrl+W", click: command("close"), enabled: hasDocument },
      { type: "separator" },
      { label: t("Save"), accelerator: "CmdOrCtrl+S", click: command("save"), enabled: hasDocument },
      { label: t("Duplicate"), accelerator: "CmdOrCtrl+Shift+S", click: command("duplicate"), enabled: hasDocument },
      { label: t("Rename…"), click: command("rename"), enabled: hasFile },
      { label: t("Move To…"), click: command("move"), enabled: hasFile },
      { type: "separator" },
      { label: t("Revert to Saved"), click: command("revert"), enabled: hasFile },
      { type: "separator" },
      { label: t("Export as PDF…"), accelerator: "CmdOrCtrl+Shift+E", click: command("export-pdf"), enabled: hasDocument },
      {
        label: t("Export as HTML…"),
        accelerator: isMac ? "Cmd+Alt+Shift+E" : undefined,
        click: command("export-html"),
        enabled: hasDocument,
      },
      ...(isMac
        ? []
        : ([
            { type: "separator" },
            { label: t("Settings…"), accelerator: "Ctrl+,", click: context.showSettings },
            { type: "separator" },
            { label: t(isWindows ? "Exit" : "Quit"), accelerator: isWindows ? undefined : "Ctrl+Q", role: "quit" },
          ] as MenuItemConstructorOptions[])),
    ],
  };

  const edit: MenuItemConstructorOptions = {
    label: t("Edit"),
    submenu: [
      { label: t("Undo"), role: "undo" },
      { label: t("Redo"), role: "redo" },
      { type: "separator" },
      { label: t("Cut"), role: "cut" },
      { label: t("Copy"), role: "copy" },
      { label: t("Paste"), role: "paste" },
      { label: t("Select All"), role: "selectAll" },
      { type: "separator" },
      { label: t("Find…"), accelerator: "CmdOrCtrl+F", click: command("find"), enabled: hasDocument },
      { label: t("Find Next"), accelerator: "CmdOrCtrl+G", click: command("find-next"), enabled: hasDocument },
      { label: t("Find Previous"), accelerator: "CmdOrCtrl+Shift+G", click: command("find-previous"), enabled: hasDocument },
      {
        label: t("Find and Replace…"),
        accelerator: isMac ? "Cmd+Alt+F" : "Ctrl+H",
        click: command("find-replace"),
        enabled: hasDocument,
      },
    ],
  };

  const format: MenuItemConstructorOptions = {
    label: t("Format"),
    submenu: [
      { label: t("Bold"), accelerator: "CmdOrCtrl+B", click: command("bold"), enabled: hasDocument },
      { label: t("Italic"), accelerator: "CmdOrCtrl+I", click: command("italic"), enabled: hasDocument },
      { label: t("Underline"), accelerator: "CmdOrCtrl+U", click: command("underline"), enabled: hasDocument },
      { label: t("Strikethrough"), accelerator: "CmdOrCtrl+Shift+X", click: command("strikethrough"), enabled: hasDocument },
      { type: "separator" },
      { label: t("Add Link"), accelerator: "CmdOrCtrl+K", click: command("link"), enabled: hasDocument },
    ],
  };

  const viewMode = (mode: "editorOnly" | "split" | "previewOnly") => () => send({ name: "view-mode", mode });
  const view: MenuItemConstructorOptions = {
    label: t("View"),
    submenu: [
      { label: t("Editor Only"), accelerator: "CmdOrCtrl+1", click: viewMode("editorOnly") },
      { label: t("Editor and Preview"), accelerator: "CmdOrCtrl+2", click: viewMode("split") },
      { label: t("Preview Only"), accelerator: "CmdOrCtrl+3", click: viewMode("previewOnly") },
      { type: "separator" },
      { label: t("Toggle Full Screen"), role: "togglefullscreen" },
    ],
  };

  const tabs: MenuItemConstructorOptions[] = [
    { label: t("Show Next Tab"), accelerator: "CmdOrCtrl+Shift+]", click: command("next-tab"), enabled: state.documentCount > 1 },
    { label: t("Show Previous Tab"), accelerator: "CmdOrCtrl+Shift+[", click: command("previous-tab"), enabled: state.documentCount > 1 },
  ];
  if (!isMac) {
    // Windows and Linux move between tabs with Ctrl+Tab as well.
    tabs.push(
      { label: t("Show Next Tab"), accelerator: "Ctrl+Tab", click: command("next-tab"), visible: false },
      { label: t("Show Previous Tab"), accelerator: "Ctrl+Shift+Tab", click: command("previous-tab"), visible: false },
    );
  }
  const window: MenuItemConstructorOptions = {
    label: t("Window"),
    role: isMac ? "windowMenu" : undefined,
    submenu: isMac
      ? [
          { label: t("Minimize"), role: "minimize" },
          { label: t("Zoom"), role: "zoom" },
          { type: "separator" },
          ...tabs,
          { type: "separator" },
          { label: t("Bring All to Front"), role: "front" },
        ]
      : [{ label: t("Minimize"), role: "minimize" }, { type: "separator" }, ...tabs],
  };

  const help: MenuItemConstructorOptions = {
    label: t("Help"),
    role: isMac ? "help" : undefined,
    submenu: [
      { label: t("Welcome Guide"), click: context.showWelcomeGuide },
      ...(isMac ? [] : ([{ type: "separator" }, { label: t("About Lauda"), click: context.showAbout }] as MenuItemConstructorOptions[])),
    ],
  };

  const template: MenuItemConstructorOptions[] = [file, edit, format, view, window, help];
  if (isMac) {
    template.unshift({
      label: "Lauda",
      submenu: [
        { label: t("About Lauda"), click: context.showAbout },
        { type: "separator" },
        { label: t("Settings…"), accelerator: "Cmd+,", click: context.showSettings },
        { type: "separator" },
        { label: t("Services"), role: "services" },
        { type: "separator" },
        { label: t("Hide Lauda"), role: "hide" },
        { label: t("Hide Others"), role: "hideOthers" },
        { label: t("Show All"), role: "unhide" },
        { type: "separator" },
        { label: t("Quit Lauda"), role: "quit" },
      ],
    });
  }
  return Menu.buildFromTemplate(template);
}
