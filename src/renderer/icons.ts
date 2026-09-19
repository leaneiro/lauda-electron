/// The toolbar's symbols, drawn to stand in for the SF Symbols the native
/// app uses (doc.plaintext, rectangle.split.2x1, doc.richtext, list.bullet),
/// which only Apple's platforms may carry. 24-point canvases, stroked in the
/// current colour, so CSS sets their ink.

const svg = (body: string, viewBox = "0 0 24 24") =>
  `<svg viewBox="${viewBox}" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  editorOnly: svg(
    `<rect x="5.5" y="2.8" width="13" height="18.4" rx="2.6"/><path d="M8.8 8h6.4M8.8 11.4h6.4M8.8 14.8h4.2"/>`,
  ),
  split: svg(`<rect x="2.6" y="4.6" width="18.8" height="14.8" rx="2.8"/><path d="M12 4.8v14.4"/>`),
  previewOnly: svg(
    `<rect x="5.5" y="2.8" width="13" height="18.4" rx="2.6"/><path d="M8.8 6.8h2.6M8.8 9.4h2.6M13.4 6.8h1.8M13.4 9.4h1.8"/><rect x="8.6" y="12.2" width="6.8" height="5.6" rx="1"/><path d="M8.9 17.4l2.3-2.4 1.6 1.5 1.1-1 1.3 1.4" stroke-width="1.2"/>`,
  ),
  outline: svg(
    `<circle cx="5.2" cy="6.6" r="1.25" fill="currentColor" stroke="none"/><circle cx="5.2" cy="12" r="1.25" fill="currentColor" stroke="none"/><circle cx="5.2" cy="17.4" r="1.25" fill="currentColor" stroke="none"/><path d="M9.2 6.6h10.4M9.2 12h10.4M9.2 17.4h10.4"/>`,
  ),
  close: `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M5 5l6 6M11 5l-6 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`,
  dot: `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="3.5" fill="currentColor"/></svg>`,
  menu: svg(`<path d="M5 7.5h14M5 12h14M5 16.5h14"/>`),
  magnifier: `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="6.8" cy="6.8" r="4.6"/><path d="M10.3 10.3l3.9 3.9"/></svg>`,
  chevronLeft: `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3L5 8l5 5"/></svg>`,
  chevronRight: `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3l5 5-5 5"/></svg>`,
  clearField: `<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke="var(--clear-field-mark)" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  saved: `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M4.8 8.2l2.2 2.2 4.2-4.6" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  editing: `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor"/><circle cx="4.9" cy="8" r="1.05" fill="#fff"/><circle cx="8" cy="8" r="1.05" fill="#fff"/><circle cx="11.1" cy="8" r="1.05" fill="#fff"/></svg>`,
  notSaved: `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="0.1 2.6" aria-hidden="true"><circle cx="8" cy="8" r="6.4"/></svg>`,
};

/// The preview width level: a page outline whose inner text column grows
/// with the level (WidthLevelIcon.swift).
export function widthLevelIcon(level: number): string {
  const column = [6, 10, 14][level] ?? 6;
  return `<svg viewBox="0 0 22 16" width="22" height="16" aria-hidden="true"><rect x="1.6" y="1.6" width="18.8" height="12.8" rx="3" fill="none" stroke="currentColor" stroke-width="1.2"/><rect class="width-column" x="${11 - column / 2}" y="4" width="${column}" height="8" rx="1.5" fill="currentColor"/></svg>`;
}
