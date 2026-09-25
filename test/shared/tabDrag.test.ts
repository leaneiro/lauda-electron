// TabDragTests.swift, the same cases, but for the native `landing` (this
// edition measures where the dropped tab slides from on the page) and the
// workspace's, which the end-to-end drag test covers here.
import { describe, expect, it } from "vitest";
import { TabDrag, tabDropIndex, tabMakeRoomOffset } from "../../src/shared/tab-drag";

describe("dragging a tab", () => {
  // Four tabs 100 wide, side by side from 0: middles at 50, 150, 250, 350.
  const middles = [50, 150, 250, 350];

  it("passes a tab once its leading edge crosses that tab's middle", () => {
    // The first tab, dragged right.
    expect(tabDropIndex(middles, 0, 40, 140)).toBe(0);
    expect(tabDropIndex(middles, 0, 60, 160)).toBe(1);
    expect(tabDropIndex(middles, 0, 300, 400)).toBe(3);
    // The last tab, dragged left.
    expect(tabDropIndex(middles, 3, 260, 360)).toBe(3);
    expect(tabDropIndex(middles, 3, 240, 340)).toBe(2);
    expect(tabDropIndex(middles, 3, 0, 100)).toBe(0);
  });

  it("reaches the end even when the dragged tab is the widest", () => {
    // Widths 200, 100, 100: held within the strip, the first tab's right edge
    // gets to 400, past the last tab's middle.
    expect(tabDropIndex([100, 250, 350], 0, 200, 400)).toBe(2);
  });

  it("moves aside the tabs it passes, the other way", () => {
    // From the first place to the third: the two it passes move left.
    expect([0, 1, 2, 3].map((index) => tabMakeRoomOffset(index, 0, 2, 100))).toEqual([0, -100, -100, 0]);
    // From the last place to the first: the others move right.
    expect([0, 1, 2, 3].map((index) => tabMakeRoomOffset(index, 3, 0, 100))).toEqual([100, 100, 100, 0]);
    // Back where it started: nothing moves.
    expect([0, 1, 2, 3].map((index) => tabMakeRoomOffset(index, 1, 1, 100))).toEqual([0, 0, 0, 0]);
  });

  // The drag as the strip runs it, from the tabs' widths and the gap between
  // them.
  it("follows the pointer within the strip", () => {
    const drag = new TabDrag(0, [100, 100, 100, 100], 6);
    const offsets = () => [0, 1, 2, 3].map((index) => drag.roomOffset(index));

    // Past the second tab's middle (156), not yet the third's (262).
    drag.translation = 60;
    expect(drag.shift).toBe(60);
    expect(drag.target).toBe(1);
    expect(offsets()).toEqual([0, -106, 0, 0]);

    // Far past the end, it stops at the last tab's place.
    drag.translation = 1000;
    expect(drag.shift).toBe(318);
    expect(drag.target).toBe(3);
    expect(offsets()).toEqual([0, -106, -106, -106]);

    // And never goes before the first.
    drag.translation = -50;
    expect(drag.shift).toBe(0);
    expect(drag.target).toBe(0);
  });
});
