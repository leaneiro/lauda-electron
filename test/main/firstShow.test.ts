import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { showWhenDrawn } from "../../src/main/first-show";

/// A window as far as showing goes: what was done to it, in order.
class FakeWindow extends EventEmitter {
  readonly done: string[] = [];
  visible = false;
  destroyed = false;

  isDestroyed(): boolean {
    return this.destroyed;
  }

  isVisible(): boolean {
    return this.visible;
  }

  show(): void {
    this.visible = true;
    this.done.push("show");
  }

  maximize(): void {
    this.done.push("maximize");
  }
}

describe("showWhenDrawn", () => {
  let window: FakeWindow;
  let slow: (number | null)[];

  beforeEach(() => {
    vi.useFakeTimers();
    window = new FakeWindow();
    slow = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the window once its page has drawn", () => {
    showWhenDrawn(window, false, (ms) => slow.push(ms), 3000);
    vi.advanceTimersByTime(400);
    expect(window.done).toEqual([]);
    window.emit("ready-to-show");
    expect(window.done).toEqual(["show"]);
    vi.advanceTimersByTime(5000);
    expect(window.done).toEqual(["show"]);
    expect(slow).toEqual([]);
  });

  it("maximizes a window that was left maximized", () => {
    showWhenDrawn(window, true, () => {}, 3000);
    window.emit("ready-to-show");
    expect(window.done).toEqual(["maximize", "show"]);
  });

  /// The page never drawing is what left the window hidden on a Windows
  /// virtual machine, with its processes running and nothing on screen.
  it("shows the window anyway when the page doesn't draw in time", () => {
    showWhenDrawn(window, false, (ms) => slow.push(ms), 3000);
    vi.advanceTimersByTime(2999);
    expect(window.done).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(window.done).toEqual(["show"]);
    expect(slow).toEqual([null]);
  });

  it("says how long a late page took once it draws, and shows the window once", () => {
    showWhenDrawn(window, false, (ms) => slow.push(ms), 3000);
    vi.advanceTimersByTime(4500);
    window.emit("ready-to-show");
    expect(window.done).toEqual(["show"]);
    expect(slow).toEqual([null, 4500]);
  });

  it("leaves alone a window a second launch has already shown", () => {
    showWhenDrawn(window, true, () => {}, 3000);
    window.show();
    window.emit("ready-to-show");
    expect(window.done).toEqual(["show"]);
  });

  it("does nothing to a window that closed meanwhile", () => {
    showWhenDrawn(window, false, () => {}, 3000);
    window.destroyed = true;
    vi.advanceTimersByTime(3000);
    expect(window.done).toEqual([]);
  });
});
