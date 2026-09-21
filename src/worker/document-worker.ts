// Walks whole documents off the window's thread, as the native app renders
// on a background queue and counts in a detached task: the preview's HTML,
// and the status bar's words and characters.
import { characterCount, wordCount } from "../shared/document";
import { renderWithLines } from "../shared/markdown";
import type { FromWorker, ToWorker } from "../shared/worker-protocol";

function answer(message: FromWorker): void {
  self.postMessage(message);
}

self.onmessage = (event: MessageEvent<ToWorker>) => {
  const request = event.data;
  try {
    switch (request.type) {
      case "render":
        answer({
          type: "rendered",
          id: request.id,
          ...renderWithLines(request.markdown, { strictLineBreaks: request.strictLineBreaks }),
        });
        break;
      case "count":
        answer({
          type: "counted",
          id: request.id,
          words: wordCount(request.text),
          characters: characterCount(request.text),
        });
        break;
    }
  } catch (error) {
    answer({ type: "failed", id: request.id, kind: error instanceof Error ? error.name : typeof error });
  }
};
