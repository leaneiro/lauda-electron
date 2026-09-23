/// Where a key moves along a row of choices the keyboard walks (the tabs,
/// the view modes, the appearance): the arrows to the neighbour, round from
/// one end to the other, Home and End to the ends, as in the ARIA patterns
/// for tab lists and radio groups. `current` is the choice that holds; null
/// for a key that doesn't move, or a row with nothing in it.
export function rowTarget(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowLeft":
      return current <= 0 ? count - 1 : current - 1;
    case "ArrowRight":
      return current < 0 || current >= count - 1 ? 0 : current + 1;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
