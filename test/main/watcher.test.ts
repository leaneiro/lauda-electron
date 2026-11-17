import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DocumentWatcher, writeAtomically } from "../../src/main/files";

/// A document's file, a folder that stands for the Trash, and everything
/// the watcher said, in order. The file manager is played by rename and rm.
function scene() {
  const root = mkdtempSync(join(tmpdir(), "lauda-watcher-"));
  const bin = join(root, "bin");
  mkdirSync(bin);
  const file = join(root, "notes.md");
  writeFileSync(file, "draft");
  const said: string[] = [];
  const watcher = new DocumentWatcher(
    {
      changed: (_path, text) => said.push(`changed:${text}`),
      trashed: () => said.push("trashed"),
      putBack: (_path, text) => said.push(`putBack:${text}`),
      goneFromTrash: () => said.push("gone"),
      renamed: (_from, to) => said.push(`renamed:${to.split(/[\\/]/).pop()}`),
    },
    () => ({ folders: [bin], perUserParents: [] }),
  );
  scenes.push({ root, watcher, file });
  return { root, bin, file, said, watcher, inBin: join(bin, "notes.md") };
}

const scenes: { root: string; watcher: DocumentWatcher; file: string }[] = [];
afterEach(() => {
  for (const { root, watcher, file } of scenes.splice(0)) {
    watcher.unwatch(file);
    rmSync(root, { recursive: true, force: true });
  }
});

async function until(condition: () => boolean, milliseconds = 4000): Promise<boolean> {
  const deadline = Date.now() + milliseconds;
  while (!condition()) {
    if (Date.now() > deadline) return false;
    await new Promise((done) => setTimeout(done, 25));
  }
  return true;
}

/// Long enough for the watcher to have said something, had it anything to say.
const quiet = () => new Promise((done) => setTimeout(done, 700));

async function watching(): Promise<ReturnType<typeof scene>> {
  const made = scene();
  // From the text the window holds, as an opened document is watched.
  made.watcher.watch(made.file, "draft");
  // The watcher asks which file this is before it can follow it anywhere.
  await new Promise((done) => setTimeout(done, 100));
  return made;
}

describe("a document's file and the Trash", () => {
  it("TRASH-01.1 says so when the file goes to the Trash", async () => {
    const { file, inBin, said, watcher } = await watching();
    renameSync(file, inBin);
    expect(await until(() => said.includes("trashed"))).toBe(true);
    expect(watcher.isInTrash(file)).toBe(true);
  });

  it("TRASH-01.1 finds the file under another name, as Windows renames what it bins", async () => {
    const { file, bin, said } = await watching();
    renameSync(file, join(bin, "$RABCDEF.md"));
    expect(await until(() => said.includes("trashed"))).toBe(true);
  });

  it("TRASH-01.6 says the file is back, with the text it has now", async () => {
    const { file, inBin, said, watcher } = await watching();
    renameSync(file, inBin);
    await until(() => said.includes("trashed"));
    writeFileSync(inBin, "final");
    renameSync(inBin, file);
    expect(await until(() => said.includes("putBack:final"))).toBe(true);
    expect(watcher.isInTrash(file)).toBe(false);
    await quiet();
    // Once: the text that came back is not also another program's change.
    expect(said).toEqual(["trashed", "putBack:final"]);
  });

  it("TRASH-01.14 says the file is gone when it leaves the Trash without coming back", async () => {
    const { file, inBin, said } = await watching();
    renameSync(file, inBin);
    await until(() => said.includes("trashed"));
    rmSync(inBin);
    expect(await until(() => said.includes("gone"))).toBe(true);
    expect(said).toEqual(["trashed", "gone"]);
  });

  it("says nothing of a file deleted without passing through the Trash, as before", async () => {
    const { file, said } = await watching();
    rmSync(file);
    await quiet();
    expect(said).toEqual([]);
  });

  it("goes on telling of another program's change", async () => {
    const { file, said } = await watching();
    writeFileSync(file, "changed elsewhere");
    expect(await until(() => said.includes("changed:changed elsewhere"))).toBe(true);
  });

  it("follows the file through the app's own write, which replaces it", async () => {
    const { file, inBin, said, watcher } = await watching();
    await writeAtomically(file, "typed");
    await watcher.noteWritten(file, "typed");
    renameSync(file, inBin);
    expect(await until(() => said.includes("trashed"))).toBe(true);
    expect(said).toEqual(["trashed"]);
  });

  it("TRASH-01.4 knows of the Trash before a write, when no news has come yet", async () => {
    const { file, inBin, said, watcher } = await watching();
    renameSync(file, inBin);
    expect(await watcher.isInTrashNow(file)).toBe(true);
    expect(said).toEqual(["trashed"]);
    expect(readFileSync(inBin, "utf8")).toBe("draft");
  });

  it("TRASH-01.1 TRASH-01.4 counts a file opened from inside the Trash as there from the start", async () => {
    const root = mkdtempSync(join(tmpdir(), "lauda-watcher-"));
    const folder = join(root, ".Trash");
    mkdirSync(folder);
    const file = join(folder, "old.md");
    writeFileSync(file, "old");
    const said: string[] = [];
    const watcher = new DocumentWatcher(
      {
        changed: () => said.push("changed"),
        trashed: () => said.push("trashed"),
        putBack: () => said.push("putBack"),
        goneFromTrash: () => said.push("gone"),
        renamed: () => said.push("renamed"),
      },
      () => ({ folders: [folder], perUserParents: [] }),
    );
    scenes.push({ root, watcher, file });
    watcher.watch(file, "old");
    // Nothing is written there, even before the watcher knows which file it is.
    expect(await watcher.isInTrashNow(file)).toBe(true);
    expect(await until(() => said.includes("trashed"))).toBe(true);
    rmSync(file);
    expect(await until(() => said.includes("gone"))).toBe(true);
    // Nor is it made again there once it is gone.
    expect(await watcher.isInTrashNow(file)).toBe(true);
  });

  it("TRASH-01.4 asks only where the file is before a write, never taking its text for a change", async () => {
    const { file, said, watcher } = await watching();
    // The system may tell of the file's making a moment after the watch
    // begins; that is not this test's.
    await quiet();
    said.length = 0;
    // The file holds a text other than the one last noted: read now, it
    // would look like another program's change.
    await watcher.noteWritten(file, "typed");
    expect(await watcher.isInTrashNow(file)).toBe(false);
    expect(said).toEqual([]);
  });

  it("TRASH-01.8 follows a file another program renamed in its folder", async () => {
    const { root, file, said } = await watching();
    renameSync(file, join(root, "ideas.md"));
    expect(await until(() => said.includes("renamed:ideas.md"))).toBe(true);
    expect(said).toEqual(["renamed:ideas.md"]);
  });

  it("TRASH-01.8 leaves a file moved to another folder as before", async () => {
    const { root, file, said } = await watching();
    const elsewhere = join(root, "elsewhere");
    mkdirSync(elsewhere);
    renameSync(file, join(elsewhere, "notes.md"));
    await quiet();
    expect(said).toEqual([]);
  });

  it("TRASH-01.6 takes another file made where this one was for no putting back", async () => {
    const { file, inBin, said, watcher } = await watching();
    renameSync(file, inBin);
    await until(() => said.includes("trashed"));
    writeFileSync(file, "someone else's");
    await quiet();
    watcher.checkAll();
    await quiet();
    expect(said).toEqual(["trashed"]);
    expect(watcher.isInTrash(file)).toBe(true);

    // And the Trash emptied meanwhile is still heard of.
    rmSync(inBin);
    watcher.checkAll();
    expect(await until(() => said.includes("gone"))).toBe(true);
  });

  it("TRASH-01.1 TRASH-01.6 finds the file in a folder thrown away whole, and back with it", async () => {
    const root = mkdtempSync(join(tmpdir(), "lauda-watcher-"));
    const bin = join(root, "bin");
    const docs = join(root, "docs");
    mkdirSync(bin);
    mkdirSync(docs);
    const file = join(docs, "notes.md");
    writeFileSync(file, "draft");
    const said: string[] = [];
    const watcher = new DocumentWatcher(
      {
        changed: () => said.push("changed"),
        trashed: () => said.push("trashed"),
        putBack: (_path, text) => said.push(`putBack:${text}`),
        goneFromTrash: () => said.push("gone"),
        renamed: () => said.push("renamed"),
      },
      () => ({ folders: [bin], perUserParents: [] }),
    );
    scenes.push({ root, watcher, file });
    watcher.watch(file);
    await new Promise((done) => setTimeout(done, 100));

    renameSync(docs, join(bin, "docs"));
    watcher.checkAll();
    expect(await until(() => said.includes("trashed"))).toBe(true);
    expect(watcher.trashedPathOf(file)).toBe(join(bin, "docs", "notes.md"));

    renameSync(join(bin, "docs"), docs);
    expect(await until(() => said.includes("putBack:draft"))).toBe(true);
  });

  it("TRASH-01.8 a write asked for just after a rename finds the new name, not the old place", async () => {
    const { root, file, said, watcher } = await watching();
    renameSync(file, join(root, "ideas.md"));
    expect(await watcher.isInTrashNow(file)).toBe(false);
    expect(said).toEqual(["renamed:ideas.md"]);
  });

  it("tells no change when nothing changed since the file was opened, as after a write that failed", async () => {
    const { said, watcher } = await watching();
    await quiet();
    said.length = 0;
    watcher.checkAll();
    await quiet();
    expect(said).toEqual([]);
  });

  it("TRASH-01.4 writes nothing over another program's file where this one was, while this one is in the Trash", async () => {
    const { file, inBin, said, watcher } = await watching();
    renameSync(file, inBin);
    await until(() => said.includes("trashed"));
    writeFileSync(file, "someone else's");
    expect(await watcher.isInTrashNow(file)).toBe(true);
  });

  it("TRASH-01.8 goes on watching a renamed file under its new name", async () => {
    const { root, file, said } = await watching();
    const renamed = join(root, "ideas.md");
    renameSync(file, renamed);
    await until(() => said.includes("renamed:ideas.md"));
    writeFileSync(renamed, "edited elsewhere");
    expect(await until(() => said.includes("changed:edited elsewhere"))).toBe(true);
  });

  it("tells a change made between the opening and the watching", async () => {
    const { file, said, watcher } = scene();
    watcher.watch(file, "as opened");
    await new Promise((done) => setTimeout(done, 100));
    watcher.checkAll();
    expect(await until(() => said.includes("changed:draft"))).toBe(true);
  });

  it("TRASH-01.14 TRASH-01.15 holds a write back once the file has left the Trash for good", async () => {
    const { file, inBin, said, watcher } = await watching();
    renameSync(file, inBin);
    await until(() => said.includes("trashed"));
    rmSync(inBin);
    expect(await watcher.isInTrashNow(file)).toBe(true);
    // A second write, asked before the window heard, is held back too.
    expect(await watcher.isInTrashNow(file)).toBe(true);
    expect(said).toEqual(["trashed", "gone"]);
  });

  it("TRASH-01.15 writes again where the file was once a file there is watched anew", async () => {
    const { file, inBin, said, watcher } = await watching();
    renameSync(file, inBin);
    await until(() => said.includes("trashed"));
    rmSync(inBin);
    await until(() => said.includes("gone"));
    // Saved there again as another document (Save As), or opened afresh.
    writeFileSync(file, "new");
    watcher.watch(file, "new");
    expect(await watcher.isInTrashNow(file)).toBe(false);
  });
});
