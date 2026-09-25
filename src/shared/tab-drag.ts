// A tab dragged along the strip to a new place among the others
// (TabDrag.swift, with the same rules and cases). The native `landing`, where
// the dropped tab slides from, isn't here: this edition measures that on the
// page (TabDragging).

/// A tab dragged along the strip, as browsers reorder tabs: it follows the
/// pointer, held within the strip, and the tabs it passes move aside to make
/// room for it. Everything is measured against where the tabs stood when the
/// drag began, not where they are moved to on the way.
export class TabDrag {
  /// Every tab's edges when the drag began, the dragged one's included.
  private readonly lefts: number[] = [];
  private readonly rights: number[] = [];
  /// The room the tabs it passes make: its own width and the gap after it.
  private readonly room: number;
  /// How far the pointer has gone since the press.
  translation = 0;

  /// The tabs side by side, `spacing` apart, as wide as they are drawn.
  constructor(
    readonly from: number,
    widths: readonly number[],
    spacing: number,
  ) {
    let left = 0;
    for (const width of widths) {
      this.lefts.push(left);
      this.rights.push(left + width);
      left += width + spacing;
    }
    this.room = (widths[from] ?? 0) + spacing;
  }

  /// How far the dragged tab has moved: with the pointer, but no further
  /// than the first tab's place on one side and the last one's on the other.
  get shift(): number {
    const first = this.lefts[0] ?? 0;
    const last = this.rights.at(-1) ?? 0;
    return Math.min(Math.max(this.translation, first - this.left), last - this.right);
  }

  /// The place the dragged tab takes if it is let go now.
  get target(): number {
    const middles = this.lefts.map((left, index) => (left + (this.rights[index] ?? left)) / 2);
    return tabDropIndex(middles, this.from, this.left + this.shift, this.right + this.shift);
  }

  /// How far the tab at `index` stands aside for the dragged one.
  roomOffset(index: number): number {
    return tabMakeRoomOffset(index, this.from, this.target, this.room);
  }

  /// The dragged tab's edges when the drag began.
  private get left(): number {
    return this.lefts[this.from] ?? 0;
  }

  private get right(): number {
    return this.rights[this.from] ?? 0;
  }
}

/// The dragged tab's new place: going right it passes each tab whose middle
/// its right edge has crossed, going left each one whose middle its left edge
/// has crossed. `middles` are every tab's, the dragged one's included, where
/// they stood when the drag began; `left` and `right` are the dragged tab's
/// edges now.
export function tabDropIndex(middles: readonly number[], from: number, left: number, right: number): number {
  const passedRight = middles.filter((middle, index) => index > from && middle < right).length;
  const passedLeft = middles.filter((middle, index) => index < from && middle > left).length;
  return from + passedRight - passedLeft;
}

/// How far the tab at `index` moves aside while the one at `from` is dragged
/// to `to`: the tabs it passes shift the other way by `room`.
export function tabMakeRoomOffset(index: number, from: number, to: number, room: number): number {
  if (index === from) return 0;
  if (from < index && index <= to) return -room;
  if (to <= index && index < from) return room;
  return 0;
}
