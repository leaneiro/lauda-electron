// The preview page's script, the native app's preview.js with a message
// channel to the window in place of WebKit's message handlers. It runs from
// the app's own scheme; the document's raw HTML shares the page but, under
// the page's Content-Security-Policy, can't run any script.

const appOrigin = "lauda-app://app";

// Timestamp of the last programmatic change; scroll events shortly after
// one are echoes (or reflows), not the reader scrolling the preview.
let suppressScrollEventsUntil = 0;

interface Position {
  atEnd?: boolean;
  line: number;
  hasLine: boolean;
  endLine: number;
  hasEndLine: boolean;
  fraction: number;
  toEndDistance: number;
  convergence: number;
}

// Where the page should stay when its text reflows (a narrower or wider
// pane, the column width, the font): the last position asked for, the line
// the reader scrolled to here, or the end. The browser keeps the pixel
// offset instead, which by then shows another line.
let lastPosition: Position | { atEnd: true } | null = null;

// Source line of each element the scroll sync anchors on (parallel to
// anchorElements()) and the document's line count.
let anchorLines: number[] = [];
let totalLines = 1;

const content = () => document.getElementById("content") as HTMLElement;

function post(message: unknown): void {
  window.parent.postMessage(message, appOrigin);
}

// Block-level DOM diff: only blocks that actually changed are replaced, so
// typing repaints one paragraph instead of relaying the whole page. Parsing
// through a detached element keeps <script> tags inert, and the page's
// policy blocks inline handlers as well.
function setContent(html: string, lines: number[], lineCount: number): void {
  suppressScrollEventsUntil = Date.now() + 200;
  anchorLines = lines || [];
  totalLines = Math.max(lineCount || 1, 1);
  const container = content();
  const parsed = document.createElement("div");
  parsed.innerHTML = html;

  const oldBlocks = Array.from(container.children);
  const newBlocks = Array.from(parsed.children);
  const common = Math.min(oldBlocks.length, newBlocks.length);
  for (let i = 0; i < common; i++) {
    if (!oldBlocks[i].isEqualNode(newBlocks[i])) container.replaceChild(newBlocks[i], oldBlocks[i]);
  }
  for (let i = oldBlocks.length - 1; i >= common; i--) container.removeChild(oldBlocks[i]);
  for (let i = common; i < newBlocks.length; i++) container.appendChild(newBlocks[i]);
}

function setStyle(family: string, size: number, lineHeight: number): void {
  reflowing(() => {
    const style = document.documentElement.style;
    style.setProperty("--pfont", family);
    style.setProperty("--psize", size + "px");
    style.setProperty("--plh", String(lineHeight));
  });
}

function setContentWidth(rem: number): void {
  reflowing(() => {
    document.documentElement.style.setProperty("--article-max", rem + "rem");
  });
}

// Applies a change that reflows the text and puts the page back at
// lastPosition. The change applies at once: an animated reflow would keep
// moving the text after the page was put back.
function reflowing(change: () => void): void {
  if (!lastPosition) rememberTopOfPage();
  suppressScrollEventsUntil = Date.now() + 300;
  const root = document.documentElement;
  root.classList.add("reflowing");
  change();
  document.body.getBoundingClientRect();
  realign();
  root.classList.remove("reflowing");
}

function rememberTopOfPage(): void {
  const max = maxScroll();
  const y = window.scrollY;
  const points = lineAnchors();
  if (max > 0 && y >= max - 1) {
    lastPosition = { atEnd: true };
  } else if (points) {
    lastPosition = {
      line: interpolate(points, y, 1, 0), hasLine: true, endLine: 0, hasEndLine: false,
      fraction: max > 0 ? y / max : 0, toEndDistance: 0, convergence: 1,
    };
  }
}

// Puts the page back at lastPosition after its text reflowed.
function realign(): void {
  if (!lastPosition) return;
  if (lastPosition.atEnd) {
    suppressScrollEventsUntil = Date.now() + 200;
    window.scrollTo(0, maxScroll());
    return;
  }
  const p = lastPosition as Position;
  setScrollPosition(p.line, p.hasLine, p.endLine, p.hasEndLine, p.fraction, p.toEndDistance, p.convergence);
}

function maxScroll(): number {
  return Math.max(document.documentElement.scrollHeight - window.innerHeight, 0);
}

// Elements the line map names, in its order: every top-level block, then the
// list items and table rows inside it. Raw HTML maps to no source line of
// ours, so nothing inside it is an anchor.
function anchorElements(): Element[] {
  const elements: Element[] = [];
  for (const block of Array.from(content().children)) {
    elements.push(block);
    if (block.classList.contains("raw")) continue;
    for (const inner of Array.from(block.querySelectorAll("li, tr"))) elements.push(inner);
  }
  return elements;
}

// [sourceLine, y] anchors: the top padding (line -1 at y 0), each mapped
// element and the document end. null when the DOM and the line map disagree
// (raw HTML can make the parser split a block); callers then fall back to
// proportional sync.
function lineAnchors(): [number, number][] | null {
  const elements = anchorElements();
  if (anchorLines.length === 0 || elements.length !== anchorLines.length) return null;
  const points: [number, number][] = [[-1, 0]];
  for (let i = 0; i < elements.length; i++) {
    const y = elements[i].getBoundingClientRect().top + window.scrollY;
    const prev = points[points.length - 1];
    if (anchorLines[i] > prev[0] && y >= prev[1]) points.push([anchorLines[i], y]);
  }
  const last = points[points.length - 1];
  const endY = document.documentElement.scrollHeight;
  if (totalLines > last[0] && endY >= last[1]) points.push([totalLines, endY]);
  return points;
}

// Piecewise-linear lookup over anchors sorted by both columns.
function interpolate(points: [number, number][], value: number, from: 0 | 1, to: 0 | 1): number {
  if (value <= points[0][from]) return points[0][to];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (value <= b[from]) {
      const span = b[from] - a[from];
      return span > 0 ? a[to] + ((value - a[from]) / span) * (b[to] - a[to]) : b[to];
    }
  }
  return points[points.length - 1][to];
}

function setScrollPosition(
  line: number, hasLine: boolean, endLine: number, hasEndLine: boolean,
  fraction: number, toEndDistance: number, convergence: number,
): void {
  lastPosition = { line, hasLine, endLine, hasEndLine, fraction, toEndDistance, convergence };
  const max = maxScroll();
  if (max <= 0) return;
  const points = hasLine ? lineAnchors() : null;
  let target = fraction * max;
  if (points) {
    target = interpolate(points, line, 0, 1);
    // Over the leader's last `convergence` points, absorb the gap between
    // where its final line lands here and this pane's end, so both panes
    // reach the bottom together while staying line-aligned before that.
    if (hasEndLine) {
      const gap = Math.max(max - interpolate(points, endLine, 0, 1), 0);
      const stretch = Math.max(Math.min(convergence, window.innerHeight), 1);
      target += gap * Math.max(0, 1 - toEndDistance / stretch);
    }
  }
  target = Math.min(Math.max(target, 0), max);
  if (Math.abs(target - window.scrollY) < 2) return;
  suppressScrollEventsUntil = Date.now() + 200;
  window.scrollTo(0, target);
}

// In-page find: wraps matches in <mark> so they can be counted and stepped through.
let findState: { query: string; marks: HTMLElement[]; index: number } = { query: "", marks: [], index: -1 };

function findClear(): void {
  for (const mark of findState.marks) {
    const parent = mark.parentNode;
    if (parent) {
      parent.replaceChild(document.createTextNode(mark.textContent ?? ""), mark);
      parent.normalize();
    }
  }
  findState = { query: "", marks: [], index: -1 };
}

function findRun(query: string, forward: boolean, restart: boolean): [number, number] {
  if (restart || query !== findState.query) {
    findClear();
    findState.query = query;
    if (!query) return [0, 0];
    const lowered = query.toLowerCase();
    const walker = document.createTreeWalker(content(), NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    for (const node of nodes) {
      let current = node;
      let position: number;
      while ((position = (current.textContent ?? "").toLowerCase().indexOf(lowered)) !== -1) {
        const match = current.splitText(position);
        const rest = match.splitText(query.length);
        const mark = document.createElement("mark");
        mark.className = "find-hit";
        match.parentNode?.replaceChild(mark, match);
        mark.appendChild(match);
        findState.marks.push(mark);
        current = rest;
      }
    }
    findState.index = findState.marks.length ? 0 : -1;
  } else if (findState.marks.length) {
    findState.index = (findState.index + (forward ? 1 : -1) + findState.marks.length) % findState.marks.length;
  }
  findState.marks.forEach((mark, i) => mark.classList.toggle("current", i === findState.index));
  if (findState.index >= 0) {
    suppressScrollEventsUntil = Date.now() + 200;
    findState.marks[findState.index].scrollIntoView({ block: "center" });
  }
  return [findState.index + 1, findState.marks.length];
}

// A resize (a view mode switch, the divider, the window) reflows the text:
// stay at lastPosition, and don't report the drifted offsets as the reader
// scrolling.
window.addEventListener("resize", () => {
  suppressScrollEventsUntil = Date.now() + 300;
  realign();
});

window.addEventListener(
  "scroll",
  () => {
    if (Date.now() < suppressScrollEventsUntil) return;
    const max = maxScroll();
    const y = window.scrollY;
    const fraction = max > 0 ? Math.min(Math.max(y / max, 0), 1) : 0;
    const toEndDistance = Math.max(max - y, 0);
    const points = lineAnchors();
    const line = points ? interpolate(points, y, 1, 0) : null;
    const endLine = points ? interpolate(points, max, 1, 0) : null;
    lastPosition =
      max > 0 && y >= max - 1
        ? { atEnd: true }
        : { line: line ?? 0, hasLine: line !== null, endLine: 0, hasEndLine: false, fraction, toEndDistance: 0, convergence: 1 };
    post({ type: "previewScrolled", line, endLine, fraction, toEndDistance });
  },
  { passive: true },
);

// Links open in the browser, as a click on one does in the native preview;
// the window decides which schemes may leave the app.
document.addEventListener(
  "click",
  (event) => {
    const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!link) return;
    event.preventDefault();
    post({ type: "openLink", href: link.href });
  },
  true,
);

// A file dropped here would replace the page.
for (const type of ["dragover", "drop"]) {
  document.addEventListener(type, (event) => event.preventDefault());
}

type Message =
  | { type: "setContent"; html: string; lines: number[]; lineCount: number; id: number }
  | { type: "setStyle"; family: string; size: number; lineHeight: number }
  | { type: "setContentWidth"; rem: number }
  | { type: "setScrollPosition"; line: number; hasLine: boolean; endLine: number; hasEndLine: boolean; fraction: number; toEndDistance: number; convergence: number }
  | { type: "realign" }
  | { type: "find"; query: string; forward: boolean; restart: boolean; id: number }
  | { type: "findClear" }
  | { type: "focus" };

window.addEventListener("message", (event: MessageEvent<Message>) => {
  if (event.source !== window.parent || event.origin !== appOrigin) return;
  const message = event.data;
  switch (message.type) {
    case "setContent":
      setContent(message.html, message.lines, message.lineCount);
      post({ type: "contentApplied", id: message.id });
      break;
    case "setStyle":
      setStyle(message.family, message.size, message.lineHeight);
      break;
    case "setContentWidth":
      setContentWidth(message.rem);
      break;
    case "setScrollPosition":
      setScrollPosition(message.line, message.hasLine, message.endLine, message.hasEndLine, message.fraction, message.toEndDistance, message.convergence);
      break;
    case "realign":
      suppressScrollEventsUntil = Date.now() + 300;
      realign();
      break;
    case "find": {
      const [current, total] = findRun(message.query, message.forward, message.restart);
      post({ type: "findResult", id: message.id, current, total });
      break;
    }
    case "findClear":
      findClear();
      break;
    case "focus":
      window.focus();
      document.documentElement.tabIndex = -1;
      document.documentElement.focus({ preventScroll: true });
      break;
  }
});

post({ type: "ready" });
