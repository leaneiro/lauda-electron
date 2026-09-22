// Builds the Windows installer and zips (electron-builder --win), and checks
// that the installer can unpack every file it carries.
//
// The 7-Zip electron-builder packs with (23 and later) gives ARM64
// executables a filter of its own, which the extractor inside the installer,
// the NSIS 7z plugin from before that filter, doesn't know: it skips those
// files without a word, and a Windows ARM PC gets every file but Lauda.exe
// and its DLLs. BCJ2, the filter the x64 package gets anyway, is one it reads.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const built = spawnSync("electron-builder", ["--win", ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, ELECTRON_BUILDER_7Z_FILTER: "BCJ2" },
});
if (built.status !== 0) process.exit(built.status ?? 1);

const output = JSON.parse(readFileSync("package.json", "utf8")).build.directories.output;
const installer = readdirSync(output).find((name) => /^Lauda Setup .+\.exe$/.test(name));
if (installer) {
  const require = createRequire(import.meta.url);
  const sevenZip = await require("app-builder-lib/out/toolsets/7zip").getPath7za();
  const temporary = mkdtempSync(join(tmpdir(), "lauda-installer-"));
  try {
    const packageInside = "$PLUGINSDIR/app-arm64.7z";
    execFileSync(sevenZip, ["x", "-y", `-o${temporary}`, join(output, installer), packageInside], { stdio: "ignore" });
    const listing = execFileSync(sevenZip, ["l", "-slt", join(temporary, packageInside)]).toString();
    // The files come after the archive's own summary, past a line of dashes.
    const files = listing.split(/^-{10}\r?$/m)[1] ?? "";
    const unreadable = files
      .split(/\r?\n\r?\n/)
      .filter((entry) => /^Method = .*\bARM64\b/m.test(entry))
      .map((entry) => entry.match(/^Path = (.+)$/m)?.[1]);
    if (unreadable.length > 0) {
      console.error(`The installer's ARM package holds files its extractor would skip: ${unreadable.join(", ")}`);
      process.exit(1);
    }
    console.log("OK: every file in the installer's ARM package can be unpacked");
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
