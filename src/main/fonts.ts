import { execFile } from "node:child_process";

let cached: Promise<string[]> | undefined;

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(command, args, { maxBuffer: 64 * 1024 * 1024, timeout: 20_000, windowsHide: true }, (error, stdout) => {
      resolve(error ? "" : stdout);
    });
  });
}

/// The font families installed on this computer, for the Settings window's
/// font pickers, sorted as the native app sorts them. Hidden system faces
/// (names starting with a dot) are left out, as on the Mac.
export function installedFontFamilies(): Promise<string[]> {
  cached ??= (async () => {
    let families: string[] = [];
    if (process.platform === "darwin") {
      const json = await run("system_profiler", ["SPFontsDataType", "-json"]);
      try {
        const data = JSON.parse(json) as { SPFontsDataType?: { typefaces?: { family?: string }[] }[] };
        families = (data.SPFontsDataType ?? []).flatMap((font) => (font.typefaces ?? []).map((face) => face.family ?? ""));
      } catch {}
    } else if (process.platform === "win32") {
      const output = await run("powershell.exe", [
        "-NoProfile",
        "-Command",
        "Add-Type -AssemblyName System.Drawing; (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }",
      ]);
      families = output.split(/\r?\n/);
    } else {
      const output = await run("fc-list", [":", "family"]);
      families = output.split("\n").map((line) => line.split(",")[0]);
    }
    const unique = new Set(families.map((family) => family.trim()).filter((family) => family && !family.startsWith(".")));
    return [...unique].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  })();
  return cached;
}
