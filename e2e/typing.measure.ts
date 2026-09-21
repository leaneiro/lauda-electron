import { test } from "@playwright/test";
import { launch } from "./launch";

/// Markdown of about `bytes`: sections of prose and lists, and a fenced
/// block every tenth, which is what the editor's code checks walk.
function sampleDocument(bytes: number): string {
  const sections: string[] = [];
  let size = 0;
  for (let n = 1; size < bytes; n++) {
    const section =
      n % 10 === 0
        ? `## Code ${n}\n\n\`\`\`swift\nlet value = ${n} // a comment -> arrow\nprint(value)\n\`\`\`\n\n`
        : `## Section ${n}\n\nSome prose with *emphasis*, a [link](https://example.com) and café, naïve façade. ${"Words go on for a while. ".repeat(4)}\n\n- item one\n- item two\n\n`;
    sections.push(section);
    size += section.length;
  }
  return sections.join("");
}

/// The window's own work for each key typed at the end of a document, from
/// Chromium's counters: script, and all tasks on the window's thread. The
/// preview's page runs apart and isn't counted.
for (const kilobytes of [1, 100]) {
  test(`typing into ${kilobytes} KB`, async () => {
    const { app, window } = await launch({ files: { "sample.md": sampleDocument(kilobytes * 1024) } });
    const session = await window.context().newCDPSession(window);
    await session.send("Performance.enable");
    await window.locator(".cm-content").click();
    await window.keyboard.press(process.platform === "darwin" ? "Meta+End" : "Control+End");
    await window.waitForTimeout(1000);
    const counters = async () => {
      const { metrics } = await session.send("Performance.getMetrics");
      return new Map(metrics.map((metric) => [metric.name, metric.value]));
    };
    const before = await counters();
    const keys = 60;
    for (let key = 0; key < keys; key++) await window.keyboard.type("a");
    // Past the pause the counts wait for.
    await window.waitForTimeout(800);
    const after = await counters();
    const perKey = (name: string) => ((((after.get(name) ?? 0) - (before.get(name) ?? 0)) * 1000) / keys).toFixed(2);
    console.log(
      `${kilobytes} KB: script ${perKey("ScriptDuration")} ms a key, all tasks ${perKey("TaskDuration")} ms a key`,
    );
    await app.close();
  });
}
