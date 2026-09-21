// TabListTests.swift, the same cases.
import { describe, expect, it } from "vitest";
import { TabList } from "../../src/shared/tab-list";

class Doc {
  constructor(readonly name: string) {}
}

function list(...names: string[]): [TabList<Doc>, Doc[]] {
  const tabs = new TabList<Doc>();
  const docs = names.map((name) => new Doc(name));
  for (const doc of docs) tabs.add(doc);
  return [tabs, docs];
}

const names = (tabs: TabList<Doc>) => tabs.items.map((doc) => doc.name);

describe("TabList", () => {
  it("shows a new tab", () => {
    const [tabs, docs] = list("a", "b");
    expect(names(tabs)).toEqual(["a", "b"]);
    expect(tabs.selected).toBe(docs[1]);
    expect(tabs.selectedIndex).toBe(1);
  });

  // The native crash: two tabs, the second showing, the first one closed.
  it("keeps the second showing when the first closes", () => {
    const [tabs, docs] = list("a", "b");
    tabs.remove(docs[0] as Doc);
    expect(names(tabs)).toEqual(["b"]);
    expect(tabs.selected).toBe(docs[1]);
    expect(tabs.selectedIndex).toBe(0);
  });

  it("hands the tab showing over to the one that takes its place", () => {
    const [tabs, docs] = list("a", "b", "c");
    tabs.select(docs[1] as Doc);
    tabs.remove(docs[1] as Doc);
    expect(tabs.selected).toBe(docs[2]);
  });

  it("hands the last tab over to the one before it", () => {
    const [tabs, docs] = list("a", "b");
    tabs.remove(docs[1] as Doc);
    expect(tabs.selected).toBe(docs[0]);
  });

  it("leaves the selection alone when another tab closes", () => {
    const [tabs, docs] = list("a", "b", "c");
    tabs.select(docs[1] as Doc);
    tabs.remove(docs[2] as Doc);
    expect(tabs.selected).toBe(docs[1]);
    expect(tabs.selectedIndex).toBe(1);
  });

  it("shows nothing once the only tab closes", () => {
    const [tabs, docs] = list("a");
    tabs.remove(docs[0] as Doc);
    expect(tabs.items).toEqual([]);
    expect(tabs.selected).toBeNull();
    expect(tabs.selectedIndex).toBeNull();
  });

  it("always shows one of its tabs, or nothing when there are none", () => {
    const [tabs, docs] = list("a", "b", "c", "d");
    for (const doc of [docs[0], docs[3], docs[1], docs[2]] as Doc[]) {
      tabs.remove(doc);
      if (tabs.selected) {
        expect(tabs.contains(tabs.selected)).toBe(true);
        expect(tabs.selectedIndex).not.toBeNull();
      } else {
        expect(tabs.items).toEqual([]);
      }
    }
  });

  it("changes nothing for a stranger", () => {
    const [tabs, docs] = list("a", "b");
    const stranger = new Doc("x");
    tabs.select(stranger);
    tabs.remove(stranger);
    expect(tabs.items).toHaveLength(2);
    expect(tabs.selected).toBe(docs[1]);
  });

  it("keeps one of a tab added twice, and shows it", () => {
    const [tabs, docs] = list("a", "b");
    tabs.add(docs[0] as Doc);
    expect(tabs.items).toHaveLength(2);
    expect(tabs.selected).toBe(docs[0]);
  });
});
