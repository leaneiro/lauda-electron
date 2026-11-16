/// What Open Recent shows for each file (RecentDocuments.menuTitles): its
/// name, and for files that share a name, as many folders before it as it
/// takes to tell them apart, the way a path is written and cut short
/// ("…/Notes/draft.md").
export function recentMenuTitles(paths: readonly string[]): string[] {
  const split = paths.map((path) => path.split(/[\\/]/).filter((part) => part !== ""));
  const separators = paths.map((path) => (path.includes("\\") && !path.includes("/") ? "\\" : "/"));
  const depth = paths.map(() => 0);
  const title = (index: number): string => {
    const parts = split[index] ?? [];
    const name = parts[parts.length - 1] ?? "";
    const shown = depth[index] ?? 0;
    if (shown === 0) return name;
    const folders = parts.slice(Math.max(0, parts.length - 1 - shown), parts.length - 1);
    return ["…", ...folders, name].join(separators[index]);
  };
  // One folder more for every title still shared, until none is or the
  // paths have no more folders to give.
  const deepest = Math.max(0, ...split.map((parts) => parts.length));
  for (let round = 0; round < deepest; round++) {
    const titles = paths.map((_, index) => title(index));
    const shared = titles.flatMap((each, index) => (titles.indexOf(each) !== titles.lastIndexOf(each) ? [index] : []));
    if (shared.length === 0) break;
    for (const index of shared) depth[index] = (depth[index] ?? 0) + 1;
  }
  return paths.map((_, index) => title(index));
}
