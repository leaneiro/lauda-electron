// Draws the app icon into build/: icon.ico for Windows, icons/<size>x<size>.png
// for Linux's icon theme and icon.png for this edition's Mac build; and,
// with `--mac <folder>`, the native app's PNGs into that folder (its
// Resources/Icons). All from the icon's drawing, build/icon.svg, the native
// app's, which sync-native brings over. Run it with `npm run icons` after
// the drawing changes.
//
// Each size is drawn from the drawing itself, by Chromium, never scaled
// down from a picture: scaled down from one large picture, as
// electron-builder did, the small sizes came out blurred, with a grey ring
// around the body. The white body fills each system's frame as its own
// icons have it, with its sides on whole pixels, which keeps them sharp.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const build = join(root, "build");

// The sizes Windows shows an app's icon at, from Microsoft's guide
// "Construct your Windows app's icon": its scaling table and its list of
// target sizes.
const windowsSizes = [16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 256];
// The fixed sizes of the hicolor icon theme, which the .deb and the .rpm
// install the icon in and the AppImage takes it from.
const linuxSizes = [16, 22, 24, 32, 36, 48, 64, 72, 96, 128, 192, 256, 512];
// The sizes the native app's .icns is assembled from (its
// Scripts/make-icon.sh); electron-builder makes this edition's from the
// largest.
const macSizes = [16, 32, 64, 128, 256, 512, 1024];

// The share of each side the body leaves empty, as each system's own grid
// has it for a square icon: 3 px inside 48 in Microsoft's (the guide "Design
// guidelines for Windows app icons"), 12 px inside 128 in GNOME's app icon
// template, and 100 px inside 1024 in Apple's.
const windowsMargin = 3 / 48;
const linuxMargin = 12 / 128;
const macMargin = 100 / 1024;

// The margin in whole pixels, so the body's sides fall on the pixel grid.
// At 16 px it is 1 px, as in the designer's own 16 px icon: Linux's and
// Apple's shares round to 2 px there, which would leave the body 12 px
// across.
function margin(size, share) {
  return size <= 16 ? 1 : Math.round(size * share);
}

// Runs in the page: draws the drawing at each size, with the body that
// margin inside the frame, and returns the PNGs in base64.
async function drawSizes({ svg, frames }) {
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  function drawn(size, x, y, width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    context.drawImage(image, x, y, width, height);
    return { canvas, context };
  }

  // Where the body's sides are, to a fraction of a pixel: along the middle
  // of each side, away from the rounded corners, the transparent share of
  // the pixels between the edge of the drawing and its middle. The body is
  // opaque, and a traced drawing's sides wander a little, so this is their
  // average.
  const full = image.naturalWidth;
  const pixels = drawn(full, 0, 0, full, full).context.getImageData(0, 0, full, full).data;
  const coverage = (x, y) => pixels[(y * full + x) * 4 + 3] / 255;
  const middle = full / 2;
  const along = [];
  for (let at = Math.round(full * 0.3); at < Math.round(full * 0.7); at++) along.push(at);
  function side(opacity) {
    let empty = 0;
    for (const at of along) {
      for (let depth = 0; depth < middle; depth++) empty += 1 - opacity(at, depth);
    }
    return empty / along.length;
  }
  const left = side((at, depth) => coverage(depth, at));
  const right = side((at, depth) => coverage(full - 1 - depth, at));
  const top = side((at, depth) => coverage(at, depth));
  const bottom = side((at, depth) => coverage(at, full - 1 - depth));

  // Scaled across and down on its own, so the body comes out square on the
  // pixel grid even where the drawing's isn't quite; a body far from square
  // would stretch the L, so it stops the script instead.
  if (Math.abs(full - left - right - (full - top - bottom)) > 1) {
    throw new Error("The icon's body isn't square: squared, it would stretch the L.");
  }
  return frames.map(({ size, margin }) => {
    const across = (size - 2 * margin) / (full - left - right);
    const down = (size - 2 * margin) / (full - top - bottom);
    const { canvas } = drawn(size, margin - left * across, margin - top * down, full * across, full * down);
    return canvas.toDataURL("image/png").slice("data:image/png;base64,".length);
  });
}

// An .ico holding each size as a PNG, which Windows reads since Vista. A
// 6-byte header (0, 1 for an icon, the number of images), then a 16-byte
// entry per image (width, height, colours, 0, planes, bits per pixel, byte
// length, offset), then the images.
function iconFile(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((png, index) => {
    const size = png.readUInt32BE(16);
    const entry = 6 + 16 * index;
    // 0 stands for 256; a larger size doesn't fit the byte and throws.
    header.writeUInt8(size === 256 ? 0 : size, entry);
    header.writeUInt8(size === 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images]);
}

// Drawn on the graphics card, the drawing's paths get 4 samples a pixel,
// so their smoothed edges take only 4 shades; drawn in software, every
// shade the covered share of a pixel calls for.
app.disableHardwareAcceleration();

// Everything else happens once the app is ready, so that any failure ends
// the script with an error instead of leaving Electron running.
app
  .whenReady()
  .then(async () => {
    const svg = readFileSync(join(build, "icon.svg"), "utf8");
    // The page draws shapes only: text (or HTML) would come out in whatever
    // font the page has, and a picture inside the drawing, even through a
    // filter, would be scaled, not drawn.
    if (/<(text|image|foreignObject|feImage)\b/.test(svg)) {
      throw new Error("The icon's drawing holds text or a picture: turn them into shapes.");
    }
    const macOption = process.argv.indexOf("--mac");
    const macFolder = macOption < 0 ? null : process.argv[macOption + 1];
    if (macFolder === undefined) throw new Error("--mac takes the folder to draw the native app's PNGs in.");
    const frames = [
      ...windowsSizes.map((size) => ({ size, margin: margin(size, windowsMargin) })),
      ...linuxSizes.map((size) => ({ size, margin: margin(size, linuxMargin) })),
      ...macSizes.map((size) => ({ size, margin: margin(size, macMargin) })),
    ];

    const window = new BrowserWindow({ show: false });
    await window.loadURL("about:blank");
    const encoded = await window.webContents.executeJavaScript(`(${drawSizes})(${JSON.stringify({ svg, frames })})`);
    const png = encoded.map((image) => Buffer.from(image, "base64"));
    const windowsImages = png.slice(0, windowsSizes.length);
    const linuxImages = png.slice(windowsSizes.length, windowsSizes.length + linuxSizes.length);
    const macImages = png.slice(windowsSizes.length + linuxSizes.length);

    writeFileSync(join(build, "icon.ico"), iconFile(windowsImages));
    rmSync(join(build, "icons"), { recursive: true, force: true });
    mkdirSync(join(build, "icons"));
    for (const [index, size] of linuxSizes.entries()) {
      writeFileSync(join(build, "icons", `${size}x${size}.png`), linuxImages[index]);
    }
    writeFileSync(join(build, "icon.png"), macImages[macImages.length - 1]);
    console.log(
      `OK: build/icon.ico (${windowsSizes.join(", ")}), build/icons (${linuxSizes.join(", ")}), build/icon.png`,
    );
    if (macFolder) {
      for (const [index, size] of macSizes.entries()) {
        writeFileSync(join(resolve(macFolder), `AppIcon-${size}.png`), macImages[index]);
      }
      console.log(`OK: AppIcon-<size>.png (${macSizes.join(", ")}) in ${resolve(macFolder)}`);
    }
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
