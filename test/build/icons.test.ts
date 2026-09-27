import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "../..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

type Picture = { width: number; height: number; pixels: Uint8Array };

/// What a PNG row filter adds back to a byte, from its neighbours to the
/// left, above and above left.
function predicted(filter: number, left: number, up: number, upLeft: number): number {
  switch (filter) {
    case 1:
      return left;
    case 2:
      return up;
    case 3:
      return (left + up) >> 1;
    case 4: {
      const estimate = left + up - upLeft;
      const toLeft = Math.abs(estimate - left);
      const toUp = Math.abs(estimate - up);
      const toUpLeft = Math.abs(estimate - upLeft);
      if (toLeft <= toUp && toLeft <= toUpLeft) return left;
      return toUp <= toUpLeft ? up : upLeft;
    }
    default:
      return 0;
  }
}

/// A PNG's size and RGBA pixels. The icons are 8-bit RGBA, not interlaced,
/// as Chromium's canvas writes them; anything else fails here rather than
/// being misread. The header chunk holds the width at byte 16, the height
/// at 20, the bit depth at 24, the colour type at 25 and the interlacing at
/// 28; every chunk is its length, its type, its data and a checksum, 12
/// bytes around the data.
function decodePNG(file: Buffer): Picture {
  expect(file.toString("latin1", 1, 4)).toBe("PNG");
  const width = file.readUInt32BE(16);
  const height = file.readUInt32BE(20);
  expect([file[24], file[25], file[28]]).toEqual([8, 6, 0]);
  const compressed: Buffer[] = [];
  for (let offset = 8; offset < file.length; offset += 12 + file.readUInt32BE(offset)) {
    if (file.toString("latin1", offset + 4, offset + 8) === "IDAT") {
      compressed.push(file.subarray(offset + 8, offset + 8 + file.readUInt32BE(offset)));
    }
  }
  const rows = inflateSync(Buffer.concat(compressed));
  const stride = width * 4;
  const pixels = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = rows.readUInt8(y * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const at = y * stride + x;
      // Neighbours off the picture count as 0.
      const left = x >= 4 ? (pixels[at - 4] ?? 0) : 0;
      const up = pixels[at - stride] ?? 0;
      const upLeft = x >= 4 ? (pixels[at - stride - 4] ?? 0) : 0;
      pixels[at] = (rows.readUInt8(y * (stride + 1) + 1 + x) + predicted(filter, left, up, upLeft)) & 0xff;
    }
  }
  return { width, height, pixels };
}

/// The images an .ico holds, by the size its directory gives them: a
/// 6-byte header with the count at byte 4, then a 16-byte entry per image
/// with the width first (0 stands for 256), the byte length at 8 and the
/// offset at 12.
function iconImages(file: Buffer): Map<number, Buffer> {
  expect(file.readUInt16LE(2)).toBe(1);
  const images = new Map<number, Buffer>();
  for (let index = 0; index < file.readUInt16LE(4); index++) {
    const entry = 6 + 16 * index;
    const start = file.readUInt32LE(entry + 12);
    images.set(file[entry] || 256, file.subarray(start, start + file.readUInt32LE(entry + 8)));
  }
  return images;
}

const windowsIcons = iconImages(readFileSync(join(root, pkg.build.win.icon)));
const linuxFolder = join(root, pkg.build.linux.icon);
// The files electron-builder takes, with its own pattern (iconConverter in
// app-builder-lib), ordered by the size their names start with: a Finder
// or Explorer window leaves files of its own in the folder.
const linuxNames = readdirSync(linuxFolder)
  .filter((name) => /^(\d+)(?:x\d+)?\.png$/i.test(name))
  .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
const linuxIcons = new Map(
  linuxNames.map((name) => [Number.parseInt(name, 10), readFileSync(join(linuxFolder, name))]),
);
const everyIcon = [
  ...[...windowsIcons].map(([size, file]) => ({ name: `Windows ${size}`, size, file })),
  ...[...linuxIcons].map(([size, file]) => ({ name: `Linux ${size}`, size, file })),
];

/// scripts/make-icons.mjs draws them. Scaled down from one large picture,
/// the small sizes came out blurred, and the native app's PNGs, with hard
/// edges at the small sizes, showed steps along them on these systems.
describe("the icons Windows and Linux show", () => {
  it("has each size Windows shows an app's icon at", () => {
    expect([...windowsIcons.keys()]).toEqual([16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 256]);
  });

  it("has each fixed size of Linux's hicolor icon theme, and nothing else", () => {
    const sizes = [16, 22, 24, 32, 36, 48, 64, 72, 96, 128, 192, 256, 512];
    expect(linuxNames).toEqual(sizes.map((size) => `${size}x${size}.png`));
  });

  it("draws each size at that size", () => {
    for (const { name, size, file } of everyIcon) {
      const { width, height } = decodePNG(file);
      expect([width, height], name).toEqual([size, size]);
    }
  });

  it("smooths the rounded corners and keeps the straight sides sharp", () => {
    for (const { name, size, file } of everyIcon) {
      const { pixels } = decodePNG(file);
      const alpha = (x: number, y: number) => pixels[(y * size + x) * 4 + 3] ?? 0;
      let smoothed = 0;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          if (alpha(x, y) > 0 && alpha(x, y) < 255) smoothed++;
        }
      }
      // Smoothed, the rounded corners alone leave more partly covered
      // pixels than half the icon's width.
      expect(smoothed, name).toBeGreaterThanOrEqual(size / 2);
      // Across the middle, each side of the body starts on a whole pixel.
      const middle = Math.floor(size / 2);
      const inward = {
        left: (step: number) => alpha(step, middle),
        right: (step: number) => alpha(size - 1 - step, middle),
        top: (step: number) => alpha(middle, step),
        bottom: (step: number) => alpha(middle, size - 1 - step),
      };
      for (const [side, along] of Object.entries(inward)) {
        let step = 0;
        while (step < size && along(step) === 0) step++;
        expect(step, `${name}, ${side}`).toBeLessThan(size);
        expect(along(step), `${name}, ${side}`).toBe(255);
      }
    }
  });

  it("has the copy the packaged app keeps beside it for Linux's window", () => {
    for (const { from } of pkg.build.extraResources) {
      expect(existsSync(join(root, from)), from).toBe(true);
    }
  });
});
