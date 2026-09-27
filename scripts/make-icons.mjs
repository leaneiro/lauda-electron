// Draws the app icon for Windows and Linux into build/: icon.ico for
// Windows, icons/<size>x<size>.png for Linux's icon theme and icon.png for
// the Mac build, from the icon's drawing, resources/icons/AppIcon.svg (the
// native app's, brought over by sync-native). Run it with `npm run icons`
// after the drawing changes.
//
// Each size is drawn from the drawing itself, by Chromium, with the L in
// its typeface, the wordmark font. Scaled down from one large picture, as
// electron-builder did, the small sizes came out blurred, with a grey ring
// around the body; and the native app's own PNGs, drawn for the Mac, have
// hard edges at the small sizes (no smoothing at all at 16 and 32 pixels),
// which showed as steps on these systems.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
// electron-builder makes the Mac build's .icns from one large picture.
const macSize = 1024;

// Runs in the page: draws the drawing at each size and returns the PNGs,
// in base64. The body's edges, where the drawing stops being transparent,
// go on whole pixels at every size, which keeps them sharp (the bottom one
// because the body is square); the margins round to the nearest pixel, so
// the body stays centred.
async function drawSizes({ svg, font, sizes }) {
  async function picture(source) {
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
    await image.decode();
    return image;
  }
  function drawn(image, size, x, y, side) {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    context.drawImage(image, x, y, side, side);
    return { canvas, context };
  }

  const face = `<style>@font-face{font-family:"Newsreader";font-weight:600;src:url(data:font/woff;base64,${font})}</style>`;
  const image = await picture(svg.replace(/<svg\b[^>]*>/, (tag) => tag + face));
  const full = image.naturalWidth;
  const { canvas: whole, context } = drawn(image, full, 0, 0, full);
  // A font the page can't use leaves the L to another typeface, and one
  // still loading leaves it out, both without a word: the icon has to come
  // out different from the drawing without the font and without its text.
  const withFont = whole.toDataURL();
  for (const source of [svg, svg.replace(/<text\b[^>]*>[^<]*<\/text>/g, "")]) {
    const without = drawn(await picture(source), full, 0, 0, full).canvas.toDataURL();
    if (without === withFont) throw new Error("The L wasn't drawn in the wordmark font.");
  }

  const pixels = context.getImageData(0, 0, full, full).data;
  let left = full;
  let right = 0;
  let top = full;
  for (let y = 0; y < full; y++) {
    for (let x = 0; x < full; x++) {
      if (pixels[(y * full + x) * 4 + 3] === 0) continue;
      left = Math.min(left, x);
      right = Math.max(right, x + 1);
      top = Math.min(top, y);
    }
  }

  return sizes.map((size) => {
    const ratio = size / full;
    const marginLeft = Math.round(left * ratio);
    const scale = (size - marginLeft - Math.round((full - right) * ratio)) / (right - left);
    const x = marginLeft - left * scale;
    const y = Math.round(top * ratio) - top * scale;
    const { canvas } = drawn(image, size, x, y, full * scale);
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
  images.forEach(({ size, png }, index) => {
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
  return Buffer.concat([header, ...images.map(({ png }) => png)]);
}

// Everything happens once the app is ready, so that any failure ends the
// script with an error instead of leaving Electron running.
app
  .whenReady()
  .then(async () => {
    const svg = readFileSync(join(root, "resources/icons/AppIcon.svg"), "utf8");
    // The page has the one typeface the L is drawn in; another would draw
    // another L.
    if (!/font-family="Newsreader\b/.test(svg)) {
      throw new Error("The icon's drawing no longer names Newsreader: give the page its typeface.");
    }
    const font = readFileSync(join(root, "resources/preview/LaudaWordmark.woff")).toString("base64");

    const window = new BrowserWindow({ show: false });
    await window.loadURL("about:blank");
    const sizes = [...new Set([...windowsSizes, ...linuxSizes, macSize])];
    const encoded = await window.webContents.executeJavaScript(
      `(${drawSizes})(${JSON.stringify({ svg, font, sizes })})`,
    );
    const png = new Map(sizes.map((size, index) => [size, Buffer.from(encoded[index], "base64")]));

    writeFileSync(join(build, "icon.ico"), iconFile(windowsSizes.map((size) => ({ size, png: png.get(size) }))));
    rmSync(join(build, "icons"), { recursive: true, force: true });
    mkdirSync(join(build, "icons"));
    for (const size of linuxSizes) writeFileSync(join(build, "icons", `${size}x${size}.png`), png.get(size));
    writeFileSync(join(build, "icon.png"), png.get(macSize));
    console.log(
      `OK: build/icon.ico (${windowsSizes.join(", ")}), build/icons (${linuxSizes.join(", ")}), build/icon.png`,
    );
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
