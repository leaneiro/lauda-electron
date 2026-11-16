import { describe, expect, it } from "vitest";
import { afterDeletedFromTrash, afterPutBack, isInsideTrash, trashPlacesFor } from "../../src/shared/document";

describe("telling the Trash from everywhere else", () => {
  it("knows the Trash of each system by its folders", () => {
    expect(isInsideTrash("/Users/ana/.Trash/notes.md")).toBe(true);
    expect(isInsideTrash("/Volumes/Disk/.Trashes/501/notes.md")).toBe(true);
    expect(isInsideTrash("/home/ana/.local/share/Trash/files/notes.md")).toBe(true);
    expect(isInsideTrash("/media/usb/.Trash-1000/files/notes.md")).toBe(true);
    expect(isInsideTrash("C:\\$Recycle.Bin\\S-1-5-21\\$RABC.md")).toBe(true);
  });

  it("leaves alone a file that only sounds like it", () => {
    expect(isInsideTrash("/Users/ana/Documents/notes.md")).toBe(false);
    expect(isInsideTrash("/Users/ana/Trash/files.md")).toBe(false);
    expect(isInsideTrash("/home/ana/Trash/files/notes.md")).toBe(false);
    expect(isInsideTrash("/Users/ana/Documents/.Trash")).toBe(false);
  });
});

describe("where a thrown away file would be", () => {
  it("is the folder the tests gave, when they gave one", () => {
    expect(
      trashPlacesFor("/work/notes.md", { platform: "linux", home: "/home/ana", uid: 1000, override: "/tmp/bin" }),
    ).toEqual({ folders: ["/tmp/bin"], perUserParents: [] });
  });

  it("is the home Trash and the volume's on macOS", () => {
    expect(trashPlacesFor("/Users/ana/notes.md", { platform: "darwin", home: "/Users/ana", uid: 501 }).folders).toEqual(
      ["/Users/ana/.Trash"],
    );
    expect(
      trashPlacesFor("/Volumes/Disk/a/notes.md", { platform: "darwin", home: "/Users/ana", uid: 501 }).folders,
    ).toEqual(["/Users/ana/.Trash", "/Volumes/Disk/.Trashes/501"]);
  });

  it("is the data folder's Trash and every folder above the file on Linux", () => {
    const places = trashPlacesFor("/media/usb/a/notes.md", { platform: "linux", home: "/home/ana", uid: 1000 });
    expect(places.folders[0]).toBe("/home/ana/.local/share/Trash/files");
    expect(places.folders).toContain("/media/usb/.Trash-1000/files");
    expect(places.folders).toContain("/media/usb/.Trash/1000/files");
    expect(places.folders).toContain("/.Trash-1000/files");
  });

  it("follows the data folder the reader set on Linux", () => {
    const places = trashPlacesFor("/home/ana/notes.md", { platform: "linux", home: "/home/ana", dataHome: "/data" });
    expect(places.folders).toEqual(["/data/Trash/files"]);
  });

  it("is one folder per user under the drive's Recycle Bin on Windows", () => {
    expect(trashPlacesFor("D:\\work\\notes.md", { platform: "win32", home: "C:\\Users\\ana" })).toEqual({
      folders: [],
      perUserParents: ["D:\\$Recycle.Bin"],
    });
  });
});

describe("TRASH-01.6 TRASH-01.11 TRASH-01.13 a file put back", () => {
  it("is read again when nothing was unsaved", () => {
    expect(afterPutBack({ isEdited: false, savedText: "draft" }, "final")).toBe("read");
  });

  it("gets the edits kept when it is as the document knew it", () => {
    expect(afterPutBack({ isEdited: true, savedText: "draft" }, "draft")).toBe("save");
  });

  it("is asked about when it changed and the document did too", () => {
    expect(afterPutBack({ isEdited: true, savedText: "draft" }, "final")).toBe("ask");
  });
});

describe("TRASH-01.14 TRASH-01.15 a file deleted from the Trash", () => {
  it("closes a document with nothing to lose", () => {
    expect(afterDeletedFromTrash({ isEdited: false })).toBe("close");
  });

  it("leaves an untitled document with the edits kept", () => {
    expect(afterDeletedFromTrash({ isEdited: true })).toBe("untitled");
  });
});
