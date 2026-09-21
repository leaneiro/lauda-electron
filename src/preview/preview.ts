// The preview page's script, the native app's preview.js with a message
// channel to the window in place of WebKit's message handlers. It runs from
// the app's own scheme; the document's raw HTML shares the page but, under
// the page's Content-Security-Policy, can't run any script.

import type { FromPreview, PreviewPosition, ToPreview } from "../shared/preview-protocol";

const appOrigin = "lauda-app://app";

// The page's own elements and the document methods the script calls, taken
// before any document's HTML enters the page: an element named after one of
// them (an <img name="createElement">) would take its place on `document`.
const root = document.documentElement;
const body = document.body;
const content = document.getElementById("content") as HTMLElement;
const createElement = document.createElement.bind(document);
const createTextNode = document.createTextNode.bind(document);
const createTreeWalker = document.createTreeWalker.bind(document);

// How long scroll events are taken as echoes of something the app did
// rather than the reader scrolling: after a change of content or position,
// and longer after a reflow, which settles in more than one frame.
const echoWindow = 200;
const reflowEchoWindow = 300;

// Timestamp of the last programmatic change; scroll events shortly after
// one are echoes (or reflows), not the reader scrolling the preview.
let suppressScrollEventsUntil = 0;

// Where the page should stay when its text reflows (a narrower or wider
// pane, the column width, the font): the last position asked for, the line
// the reader scrolled to here, or the end. The browser keeps the pixel
// offset instead, which by then shows another line.
let lastPosition: PreviewPosition | "end" | null = null;

// Source line of each element the scroll sync anchors on (parallel to
// anchorElements()) and the document's line count.
let anchorLines: number[] = [];
let totalLines = 1;

function post(message: FromPreview): void {
  window.parent.postMessage(message, appOrigin);
}

// Block-level DOM diff: only blocks that actually changed are replaced, so
// typing repaints one paragraph instead of relaying the whole page. Parsing
// through a detached element keeps <script> tags inert, and the page's
// policy blocks inline handlers as well.
function setContent(html: string, lines: number[], lineCount: number): void {
  suppressScrollEventsUntil = Date.now() + echoWindow;
  anchorsMoved();
  anchorLines = lines;
  totalLines = Math.max(lineCount, 1);
  const parsed = createElement("div");
  parsed.innerHTML = html;

  const oldBlocks = Array.from(content.children);
  const newBlocks = Array.from(parsed.children);
  const common = Math.min(oldBlocks.length, newBlocks.length);
  oldBlocks.slice(0, common).forEach((oldBlock, i) => {
    const newBlock = newBlocks[i];
    if (newBlock && !oldBlock.isEqualNode(newBlock)) content.replaceChild(newBlock, oldBlock);
  });
  for (const block of oldBlocks.slice(common)) content.removeChild(block);
  for (const block of newBlocks.slice(common)) content.appendChild(block);
}

function setStyle(family: string, size: number, lineHeight: number): void {
  reflowing(() => {
    root.style.setProperty("--pfont", family);
    root.style.setProperty("--psize", `${size}px`);
    root.style.setProperty("--plh", String(lineHeight));
  });
}

function setContentWidth(rem: number): void {
  reflowing(() => {
    root.style.setProperty("--article-max", `${rem}rem`);
  });
}

// Applies a change that reflows the text and puts the page back at
// lastPosition. The change applies at once: an animated reflow would keep
// moving the text after the page was put back.
function reflowing(change: () => void): void {
  if (!lastPosition) rememberTopOfPage();
  suppressScrollEventsUntil = Date.now() + reflowEchoWindow;
  root.classList.add("reflowing");
  change();
  // Lays out the new text now.
  body.getBoundingClientRect();
  anchorsMoved();
  realign();
  root.classList.remove("reflowing");
}

// A position the page takes from where the reader left it: no other pane
// leads, so there is no end to converge on.
function ownPosition(line: number | null, fraction: number): PreviewPosition {
  return { line, endLine: null, fraction, toEndDistance: 0, convergence: 1 };
}

// Takes the current position as lastPosition: the end of the page, or the
// line at the top.
function rememberTopOfPage(): void {
  const max = maxScroll();
  const y = window.scrollY;
  const points = lineAnchors();
  if (max > 0 && y >= max - 1) {
    lastPosition = "end";
  } else if (points) {
    lastPosition = ownPosition(interpolate(points, y, 1, 0), max > 0 ? y / max : 0);
  }
}

// Puts the page back at lastPosition after its text reflowed.
function realign(): void {
  if (lastPosition === "end") {
    suppressScrollEventsUntil = Date.now() + echoWindow;
    window.scrollTo(0, maxScroll());
  } else if (lastPosition) {
    setScrollPosition(lastPosition);
  }
}

function maxScroll(): number {
  return Math.max(root.scrollHeight - window.innerHeight, 0);
}

// Elements the line map names, in its order: every top-level block, then the
// list items and table rows inside it. Raw HTML maps to no source line of
// ours, so nothing inside it is an anchor.
function anchorElements(): Element[] {
  const elements: Element[] = [];
  for (const block of Array.from(content.children)) {
    elements.push(block);
    if (block.classList.contains("raw")) continue;
    for (const inner of Array.from(block.querySelectorAll("li, tr"))) elements.push(inner);
  }
  return elements;
}

// The anchors as they were last measured. Measuring walks every block, and
// every list item and table row inside it, reading each one's position, so
// it is done once and kept until something moves the text: new content, a
// reflow, a resize, or an image that finishes loading (the observer below
// catches the last two). Scroll events then cost a lookup rather than a
// pass over the page, which is what a long list made expensive.
let measuredAnchors: { points: [number, number][] | null; shape: string } | null = null;

function anchorsMoved(): void {
  measuredAnchors = null;
}

// What the anchors were measured against. A reflow the app didn't ask for
// (a late image, a stylesheet) changes one of these, and the anchors are
// measured again before they are read, rather than waiting for the
// observer's turn, which comes after the reader may have scrolled.
function contentShape(): string {
  return `${content.clientWidth}x${root.scrollHeight}`;
}

// [sourceLine, y] anchors: the top padding (line -1 at y 0), each mapped
// element and the document end. null when the DOM and the line map disagree
// (raw HTML can make the parser split a block); callers then fall back to
// proportional sync.
function lineAnchors(): [number, number][] | null {
  const shape = contentShape();
  if (measuredAnchors?.shape === shape) return measuredAnchors.points;
  const points = measureLineAnchors();
  measuredAnchors = { points, shape };
  return points;
}

function measureLineAnchors(): [number, number][] | null {
  const elements = anchorElements();
  if (anchorLines.length === 0 || elements.length !== anchorLines.length) return null;
  let last: [number, number] = [-1, 0];
  const points: [number, number][] = [last];
  elements.forEach((element, i) => {
    const line = anchorLines[i];
    if (line === undefined) return;
    const y = element.getBoundingClientRect().top + window.scrollY;
    if (line > last[0] && y >= last[1]) {
      last = [line, y];
      points.push(last);
    }
  });
  const endY = root.scrollHeight;
  if (totalLines > last[0] && endY >= last[1]) points.push([totalLines, endY]);
  return points;
}

// Piecewise-linear lookup over anchors sorted by both columns.
function interpolate(points: [number, number][], value: number, from: 0 | 1, to: 0 | 1): number {
  const [first, ...rest] = points;
  // lineAnchors always starts with the padding's anchor.
  if (!first) return 0;
  if (value <= first[from]) return first[to];
  let a = first;
  for (const b of rest) {
    if (value <= b[from]) {
      const span = b[from] - a[from];
      return span > 0 ? a[to] + ((value - a[from]) / span) * (b[to] - a[to]) : b[to];
    }
    a = b;
  }
  return a[to];
}

// Where the top of the page goes for a position: at its line, where the page
// can place lines, else at its fraction of the way down.
function scrollTarget(at: PreviewPosition, max: number): number {
  const points = at.line === null ? null : lineAnchors();
  if (at.line === null || !points) return at.fraction * max;
  const target = interpolate(points, at.line, 0, 1);
  if (at.endLine === null) return target;
  // Over the leader's last `convergence` points, absorb the gap between
  // where its final line lands here and this pane's end, so both panes
  // reach the bottom together while staying line-aligned before that.
  const gap = Math.max(max - interpolate(points, at.endLine, 0, 1), 0);
  const stretch = Math.max(Math.min(at.convergence, window.innerHeight), 1);
  return target + gap * Math.max(0, 1 - at.toEndDistance / stretch);
}

function setScrollPosition(at: PreviewPosition): void {
  lastPosition = at;
  const max = maxScroll();
  if (max <= 0) return;
  const target = Math.min(Math.max(scrollTarget(at, max), 0), max);
  if (Math.abs(target - window.scrollY) < 2) return;
  suppressScrollEventsUntil = Date.now() + echoWindow;
  window.scrollTo(0, target);
}

// In-page find: wraps matches in <mark> so they can be counted and stepped through.
let findState: { query: string; marks: HTMLElement[]; index: number } = { query: "", marks: [], index: -1 };

function findClear(): void {
  for (const mark of findState.marks) {
    const parent = mark.parentNode;
    if (parent) {
      parent.replaceChild(createTextNode(mark.textContent ?? ""), mark);
      parent.normalize();
    }
  }
  findState = { query: "", marks: [], index: -1 };
}

function findRun(query: string, forward: boolean, restart: boolean): { current: number; total: number } {
  if (restart || query !== findState.query) {
    findClear();
    findState.query = query;
    if (!query) return { current: 0, total: 0 };
    const lowered = query.toLowerCase();
    const walker = createTreeWalker(content, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    for (const node of nodes) {
      let current = node;
      let position: number;
      // biome-ignore lint/suspicious/noAssignInExpressions: a scan that walks matches finds the next one in its own condition.
      while ((position = (current.textContent ?? "").toLowerCase().indexOf(lowered)) !== -1) {
        const match = current.splitText(position);
        const rest = match.splitText(query.length);
        const mark = createElement("mark");
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
  findState.marks.forEach((mark, i) => {
    mark.classList.toggle("current", i === findState.index);
  });
  if (findState.index >= 0) {
    suppressScrollEventsUntil = Date.now() + echoWindow;
    findState.marks[findState.index]?.scrollIntoView({ block: "center" });
  }
  return { current: findState.index + 1, total: findState.marks.length };
}

// A resize (a view mode switch, the divider, the window) reflows the text:
// stay at lastPosition, and don't report the drifted offsets as the reader
// scrolling.
window.addEventListener("resize", () => {
  suppressScrollEventsUntil = Date.now() + reflowEchoWindow;
  anchorsMoved();
  realign();
});

// Where the page is, for the editor to follow. The anchors are measured
// once (lineAnchors), so an event costs a lookup and the message itself.
function reportScrolled(): void {
  const max = maxScroll();
  const y = window.scrollY;
  const fraction = max > 0 ? Math.min(Math.max(y / max, 0), 1) : 0;
  const toEndDistance = Math.max(max - y, 0);
  const points = lineAnchors();
  const line = points ? interpolate(points, y, 1, 0) : null;
  const endLine = points ? interpolate(points, max, 1, 0) : null;
  lastPosition = max > 0 && y >= max - 1 ? "end" : ownPosition(line, fraction);
  post({ type: "previewScrolled", line, endLine, fraction, toEndDistance });
}

window.addEventListener(
  "scroll",
  () => {
    if (Date.now() < suppressScrollEventsUntil) return;
    reportScrolled();
  },
  { passive: true },
);

// The content grows on its own when an image finishes loading, and the
// anchors below it move with it. Watching its box catches that, and the
// reflows a stylesheet can cause without any of the calls above.
new ResizeObserver(() => anchorsMoved()).observe(content);

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

window.addEventListener("message", (event: MessageEvent<ToPreview>) => {
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
      setScrollPosition(message.position);
      break;
    case "realign":
      suppressScrollEventsUntil = Date.now() + reflowEchoWindow;
      realign();
      break;
    case "find":
      post({ type: "findResult", id: message.id, ...findRun(message.query, message.forward, message.restart) });
      break;
    case "findClear":
      findClear();
      break;
    case "focus":
      window.focus();
      root.tabIndex = -1;
      root.focus({ preventScroll: true });
      break;
  }
});

post({ type: "ready" });
