import { describe, expect, it } from "vitest";
import { defaultWindowSize, placeWindow } from "../../src/main/placement";

const laptop = { x: 0, y: 25, width: 1440, height: 875 };
const monitorToTheRight = { x: 1440, y: 0, width: 2560, height: 1415 };

describe("placeWindow", () => {
  it("opens at its first size, where the system puts it, the first time", () => {
    expect(placeWindow(undefined, [laptop])).toEqual(defaultWindowSize);
  });

  it("goes back where it was on a screen that is still there", () => {
    const saved = { x: 1600, y: 100, width: 1100, height: 700, maximized: false };
    expect(placeWindow(saved, [laptop, monitorToTheRight])).toEqual({ x: 1600, y: 100, width: 1100, height: 700 });
  });

  it("is centred on the main screen when its screen was unplugged", () => {
    const saved = { x: 1600, y: 100, width: 1100, height: 700, maximized: false };
    expect(placeWindow(saved, [laptop])).toEqual({ width: 1100, height: 700 });
  });

  it("stays where it was when only part of it hangs off the screen, title bar in reach", () => {
    const saved = { x: 1000, y: 300, width: 1100, height: 700, maximized: false };
    expect(placeWindow(saved, [laptop])).toEqual({ x: 1000, y: 300, width: 1100, height: 700 });
  });

  it("comes back when its title bar is out of reach", () => {
    // All but a sliver past the right edge, and above the top.
    expect(placeWindow({ x: 1400, y: 100, width: 800, height: 600, maximized: false }, [laptop])).toEqual({
      width: 800,
      height: 600,
    });
    expect(placeWindow({ x: 100, y: -500, width: 800, height: 600, maximized: false }, [laptop])).toEqual({
      width: 800,
      height: 600,
    });
  });

  it("is no larger than the main screen when it comes back", () => {
    const saved = { x: 3000, y: 0, width: 2400, height: 1300, maximized: false };
    expect(placeWindow(saved, [laptop])).toEqual({ width: 1440, height: 875 });
  });

  it("keeps a size of its own when it was never moved", () => {
    expect(placeWindow({ width: 900, height: 600, maximized: false }, [laptop])).toEqual({ width: 900, height: 600 });
  });
});
