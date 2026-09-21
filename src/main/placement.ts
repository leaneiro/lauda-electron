import type { WindowState } from "./store";

export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

/// The window's size before it was ever moved or resized.
export const defaultWindowSize = { width: 1200, height: 800 };

/// How much of the title bar must be on a screen for the window to go back
/// where it was: enough to take hold of and drag.
const titleBarHeight = 40;
const graspableWidth = 100;
const graspableHeight = 20;

function overlap(a: Rectangle, b: Rectangle): { width: number; height: number } {
  return {
    width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  };
}

/// Where the window opens, given where it was and the screens there are now
/// (their work areas). It goes back where it was when its title bar is still
/// on one of them; a screen that was unplugged, or one that shrank, would
/// otherwise leave it out of reach. Then the system centres it, no larger
/// than the main screen.
export function placeWindow(
  saved: WindowState | undefined,
  workAreas: readonly Rectangle[],
): { x?: number; y?: number; width: number; height: number } {
  const width = saved?.width ?? defaultWindowSize.width;
  const height = saved?.height ?? defaultWindowSize.height;
  if (saved?.x !== undefined && saved.y !== undefined) {
    const titleBar = { x: saved.x, y: saved.y, width, height: titleBarHeight };
    const reachable = workAreas.some((area) => {
      const shared = overlap(titleBar, area);
      return shared.width >= Math.min(graspableWidth, width) && shared.height >= graspableHeight;
    });
    if (reachable) return { x: saved.x, y: saved.y, width, height };
  }
  const main = workAreas[0];
  if (!main) return { width, height };
  return { width: Math.min(width, main.width), height: Math.min(height, main.height) };
}
