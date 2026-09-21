// Parses Markdown off the window's thread, as the native preview renders on
// a background queue.
import { renderWithLines } from "../shared/markdown";

interface RenderRequest {
  id: number;
  markdown: string;
  strictLineBreaks: boolean;
}

self.onmessage = (event: MessageEvent<RenderRequest>) => {
  const { id, markdown, strictLineBreaks } = event.data;
  try {
    const rendered = renderWithLines(markdown, { strictLineBreaks });
    self.postMessage({ id, ...rendered });
  } catch (error) {
    // Its kind only: a parser's message can quote the document.
    self.postMessage({ id, error: error instanceof Error ? error.name : typeof error });
  }
};
