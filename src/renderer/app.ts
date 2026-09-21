import { configure, lauda } from "./api";
import { followTheme } from "./theme";
import { TitleBar } from "./titlebar";
import { Workspace } from "./workspace";

async function start(): Promise<void> {
  const state = await lauda.invoke("app:init");
  configure(state);
  followTheme();
  document.documentElement.style.setProperty("--window-controls-room", `${state.windowControlsWidth}px`);

  const workspace = new Workspace(document.getElementById("documents") as HTMLElement, state.settings);
  new TitleBar(document.getElementById("titlebar") as HTMLElement, workspace);

  lauda.on("workspace:open", (request) => workspace.open(request));
  lauda.on("workspace:select", ({ filePath }) => workspace.selectFile(filePath));
  lauda.on("menu:command", (command) => void workspace.perform(command));
  lauda.on("settings:changed", (settings) => workspace.applySettings(settings));
  lauda.on("doc:changed-on-disk", ({ filePath, text }) => workspace.fileChangedOnDisk(filePath, text));
  lauda.on("workspace:close-everything", async ({ reason }) => {
    const ok = await workspace.closeEverything(reason);
    await lauda.invoke("window:closed-everything", ok);
  });
  lauda.on("window:state", ({ isFullScreen, isFocused }) => {
    document.body.classList.toggle("fullscreen", isFullScreen);
    if (!isFocused) workspace.flushAutosaves();
  });
  // Leaving the window writes every document, as macOS autosaves when an
  // app loses focus.
  window.addEventListener("blur", () => workspace.flushAutosaves());

  // Files dropped anywhere but on the editor open as tabs.
  document.addEventListener("dragover", (event) => {
    if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
  });
  document.addEventListener("drop", (event) => {
    event.preventDefault();
    const paths = Array.from(event.dataTransfer?.files ?? []).map((file) => lauda.pathForFile(file)).filter(Boolean);
    if (paths.length > 0) void lauda.invoke("app:open-files", paths);
  });
}

void start();
