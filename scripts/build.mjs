// Builds the app into dist/: the main process and the preload script for
// Node, the window's interface, the render worker and the preview page's
// script for the browser, and the static files next to them.

import { execSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const production = process.argv.includes("--production");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

// Stamped into the About panel, as the native app stamps its bundle.
let gitHash = "dev";
try {
  gitHash = execSync("git rev-parse --short HEAD", { cwd: root, stdio: ["ignore", "pipe", "ignore"] })
    .toString()
    .trim();
} catch {}

const common = {
  bundle: true,
  sourcemap: production ? false : "linked",
  minify: production,
  logLevel: "warning",
  define: { __GIT_HASH__: JSON.stringify(gitHash) },
};

await Promise.all([
  build({
    ...common,
    entryPoints: { main: "src/main/main.ts", preload: "src/preload/preload.ts" },
    outdir: dist,
    platform: "node",
    format: "cjs",
    // The runtime Electron 44 ships (Node 24, Chromium 152): nothing is
    // lowered that it runs as written.
    target: "node24",
    external: ["electron"],
  }),
  build({
    ...common,
    entryPoints: {
      "renderer/app": "src/renderer/app.ts",
      "renderer/settings": "src/renderer/settings/settings-app.ts",
      "preview/preview": "src/preview/preview.ts",
    },
    outdir: dist,
    platform: "browser",
    format: "iife",
    target: "chrome152",
  }),
  // A worker has no DOM: packages that ship a version for workers (the
  // parser's entity decoder does) must use that one.
  build({
    ...common,
    entryPoints: { "renderer/render-worker": "src/worker/render-worker.ts" },
    outdir: dist,
    platform: "browser",
    conditions: ["worker"],
    format: "iife",
    target: "chrome152",
  }),
]);

for (const file of ["index.html", "settings.html"]) {
  cpSync(join(root, "src/renderer", file), join(dist, "renderer", file));
}
cpSync(join(root, "src/renderer/styles"), join(dist, "renderer/styles"), { recursive: true });
cpSync(join(root, "resources"), join(dist, "resources"), { recursive: true });

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
writeFileSync(join(dist, "build-info.json"), JSON.stringify({ version: pkg.version, gitHash }, null, 2));

console.log(`OK: dist (${gitHash}${production ? ", production" : ""})`);
