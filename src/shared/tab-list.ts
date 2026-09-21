/// The open tabs and the one showing (TabList.swift). The selection is the
/// item itself, not its position: a list that shrinks can then never leave
/// the selection pointing past its end, which is what crashed the native
/// app when the first tab was closed with the second one showing. Each
/// change is one step, so nothing reading in between sees half of it.
export class TabList<Item> {
  private list: Item[] = [];
  private current: Item | null = null;

  get items(): readonly Item[] {
    return this.list;
  }

  get selected(): Item | null {
    return this.current;
  }

  get selectedIndex(): number | null {
    const index = this.current === null ? -1 : this.list.indexOf(this.current);
    return index < 0 ? null : index;
  }

  contains(item: Item): boolean {
    return this.list.includes(item);
  }

  /// A new tab opens at the end and is the one showing.
  add(item: Item): void {
    if (!this.contains(item)) this.list.push(item);
    this.current = item;
  }

  select(item: Item): void {
    if (this.contains(item)) this.current = item;
  }

  /// Removes a tab. If it was the one showing, the tab that slides into its
  /// place takes over, or the one before it when it was the last.
  remove(item: Item): void {
    const index = this.list.indexOf(item);
    if (index < 0) return;
    this.list.splice(index, 1);
    if (this.current !== item) return;
    this.current = this.list[Math.min(index, this.list.length - 1)] ?? null;
  }
}
