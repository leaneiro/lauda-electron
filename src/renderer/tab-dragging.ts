import { TabDrag } from "../shared/tab-drag";
import type { LaudaDocument } from "./document";
import { tabAnimation, type Workspace } from "./workspace";

/// How far the pointer goes before a press on a tab becomes a drag; less is
/// still a click.
const dragThreshold = 4;

/// Dragging a tab along the strip to reorder it, as the native strip does:
/// the tab follows the pointer, the others make room for it, and the order
/// it is dropped in becomes the workspace's (and the session's). The rules
/// are TabDrag's; this carries them out on the page.
export class TabDragging {
  /// Ends the press or the drag under way, if any, without a new order.
  private stop: (() => void) | null = null;

  constructor(
    private readonly strip: HTMLElement,
    private readonly workspace: Workspace,
  ) {}

  /// A tab opened or closed during a drag changes the places it measures
  /// against: the drag ends there, every tab back in its place.
  cancel(): void {
    this.stop?.();
  }

  /// A press on a tab, which becomes a drag once the pointer moves sideways.
  /// The close button keeps its own presses.
  press(event: PointerEvent, tab: HTMLElement, document: LaudaDocument): void {
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest(".tab-close"))) return;
    // A tab on its way out takes room until it is gone, and the others slide
    // over it: a drag begun meanwhile would measure against moving places.
    // A click still selects.
    if (this.strip.querySelector(".tab.is-leaving")) return;
    this.stop?.();
    const tabs = [...this.strip.querySelectorAll<HTMLElement>(".tab:not(.is-leaving):not(.is-fading)")];
    const from = tabs.indexOf(tab);
    const [first, second] = tabs;
    // A lone tab, or one on its way out, stays where it is.
    if (from < 0 || !first || !second) return;
    // The tabs as laid out, not as drawn: one still coming in, or sliding
    // into place after a drop, would skew what the drag measures against.
    const gap = second.offsetLeft - first.offsetLeft - first.offsetWidth;
    const drag = new TabDrag(
      from,
      tabs.map((each) => each.offsetWidth),
      gap,
    );
    const start = event.clientX;
    let dragging = false;

    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== event.pointerId) return;
      // Let go outside the window, the press ended where nothing heard it.
      if ((moveEvent.buttons & 1) === 0) {
        finish(false);
        return;
      }
      drag.translation = moveEvent.clientX - start;
      if (!dragging) {
        if (Math.abs(drag.translation) < dragThreshold) return;
        dragging = true;
        // Only a drag keeps the pointer: a press let go away from its tab
        // is no click, as before tabs could be dragged.
        tab.setPointerCapture(event.pointerId);
        this.workspace.select(document);
        tab.classList.add("is-dragged");
      }
      tab.style.transform = `translateX(${drag.shift}px)`;
      tabs.forEach((other, index) => {
        if (other !== tab) other.style.transform = `translateX(${drag.roomOffset(index)}px)`;
      });
    };
    const up = (upEvent: PointerEvent) => {
      if (upEvent.pointerId === event.pointerId) finish(true);
    };
    const cancelled = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId === event.pointerId) finish(false);
    };
    const finish = (drops: boolean) => {
      this.stop = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancelled);
      if (!dragging) return;
      if (tab.hasPointerCapture(event.pointerId)) tab.releasePointerCapture(event.pointerId);
      const target = drag.target;
      this.settle(tabs, tab, drops && target !== from ? () => this.workspace.moveTab(document, target) : null);
    };
    this.stop = () => finish(false);
    // The window's, not the tab's: before the pointer is kept, it can move
    // off the tab on its way to becoming a drag.
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancelled);
  }

  /// The end of a drag, with a new order or without one: every tab slides
  /// from where it is drawn into its place in the order that stands, the
  /// dragged one from under the pointer and over the others until it is
  /// there.
  private settle(tabs: HTMLElement[], tab: HTMLElement, reorder: (() => void) | null): void {
    const before = tabs.map((each) => each.getBoundingClientRect().left);
    this.strip.classList.add("is-settling");
    for (const each of tabs) each.style.transform = "";
    reorder?.();
    const shifts = tabs.map((each, index) => (before[index] ?? 0) - each.getBoundingClientRect().left);
    tabs.forEach((each, index) => {
      each.style.transform = `translateX(${shifts[index]}px)`;
    });
    // Styled where they were drawn while nothing animates: taken together
    // with the transitions coming back, the shifts would animate from the
    // new places instead of to them.
    tab.getBoundingClientRect();
    this.strip.classList.remove("is-settling");
    tab.classList.replace("is-dragged", "is-landing");
    requestAnimationFrame(() => {
      for (const each of tabs) each.style.transform = "";
    });
    window.setTimeout(() => tab.classList.remove("is-landing"), tabAnimation);
  }
}
