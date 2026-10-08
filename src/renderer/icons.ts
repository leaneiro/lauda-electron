/// The toolbar's symbols, drawn to stand in for the SF Symbols the native
/// app uses (doc.plaintext, rectangle.split.2x1, doc.richtext, list.bullet),
/// which only Apple's platforms may carry. 24-point canvases, stroked in the
/// current colour, so CSS sets their ink.

const svg = (body: string, viewBox = "0 0 24 24") =>
  `<svg viewBox="${viewBox}" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  editorOnly: svg(
    `<rect x="5.5" y="2.8" width="13" height="18.4" rx="2.6"/><path d="M8.7 7h6.2M8.7 9.6h6.2M8.7 12.2h3.4" stroke-width="1.45"/>`,
  ),
  split: svg(`<rect x="2.6" y="4.6" width="18.8" height="14.8" rx="2.8"/><path d="M12 4.8v14.4"/>`),
  // A letter and two lines over a picture, the picture's hill and sun cut
  // out of it, as in doc.richtext.
  previewOnly: svg(
    `<defs><mask id="picture-cutout"><rect width="24" height="24" fill="#fff"/><path d="M8.6 18.4l2.4-2.2 1.5 1.3 1.1-0.9 1.9 1.8z" fill="#000"/><circle cx="10.2" cy="14.4" r="0.8" fill="#000"/></mask></defs><rect x="5.5" y="2.8" width="13" height="18.4" rx="2.6"/><path d="M8.3 10.3l1.65-4.5 1.65 4.5M8.85 8.9h2.2" stroke-width="1.35"/><path d="M13.1 6.6h2.4M13.1 9.2h2.4" stroke-width="1.35"/><rect x="8.1" y="12.3" width="7.8" height="6.4" rx="0.9" fill="currentColor" stroke="none" mask="url(#picture-cutout)"/>`,
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

/// The chain on the divider, drawn as the system's link symbol is
/// (ChainIcon.swift): two links on the diagonal, hooked into each other
/// while the panes scroll together, each passing over the other at one
/// crossing and under it at the other, a little apart while they don't.
/// The masks carry the cuts, each link's in the other's halo on its side of
/// the diagonal; where the links sit and how wide the cuts are go with the
/// icon as custom properties, which the stylesheet eases between. The ids
/// are made unique, since every document has a divider of its own on the
/// page.
///
/// The system's link symbol at 17 pt, measured at 12x: links 11.7 by 8
/// outside with a 2.25 stroke, their centres 6.7 apart along the diagonal;
/// here a tenth larger, as in the native app. Apart, a gap of 2 between
/// the links' ends; the link underneath is cut 1.65 on each side of the one
/// passing over it.
const chainLink = { length: 12.87, width: 8.8, stroke: 2.475, hooked: 7.37, gap: 2, cut: 1.65 };
export function chainIcon(id: string): string {
  const { length, width, stroke, hooked, gap, cut } = chainLink;
  const figures = [
    `--link-hooked: ${hooked / 2}px`,
    `--link-apart: ${(length + gap) / 2}px`,
    `--halo-hooked: ${stroke + 2 * cut}px`,
    `--halo-apart: ${stroke}px`,
  ].join("; ");
  // A link's ring, stroked on its middle so that its outside is length by
  // width; the links move along the diagonal, the group's x.
  const ring = (classes: string) =>
    `<rect class="${classes}" x="${-(length - stroke) / 2}" y="${-(width - stroke) / 2}" width="${length - stroke}" height="${width - stroke}" rx="${(width - stroke) / 2}"/>`;
  const half = 16;
  return `<svg class="chain" style="${figures}" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" stroke-width="${stroke}" aria-hidden="true"><defs><clipPath id="${id}-one-side"><rect x="${-half}" y="${-half}" width="${2 * half}" height="${half}"/></clipPath><clipPath id="${id}-other-side"><rect x="${-half}" y="0" width="${2 * half}" height="${half}"/></clipPath><mask id="${id}-cut-lower" maskUnits="userSpaceOnUse" x="${-half}" y="${-half}" width="${2 * half}" height="${2 * half}"><rect x="${-half}" y="${-half}" width="${2 * half}" height="${2 * half}" fill="#fff"/><g clip-path="url(#${id}-one-side)" stroke="#000">${ring("halo upper")}</g></mask><mask id="${id}-cut-upper" maskUnits="userSpaceOnUse" x="${-half}" y="${-half}" width="${2 * half}" height="${2 * half}"><rect x="${-half}" y="${-half}" width="${2 * half}" height="${2 * half}" fill="#fff"/><g clip-path="url(#${id}-other-side)" stroke="#000">${ring("halo lower")}</g></mask></defs><g transform="translate(${half} ${half}) rotate(-45)"><g mask="url(#${id}-cut-lower)">${ring("link lower")}</g><g mask="url(#${id}-cut-upper)">${ring("link upper")}</g></g></svg>`;
}

/// How wide the text column is drawn at each width level.
const widthColumns = [6, 10, 14];
export function widthColumn(level: number): number {
  return widthColumns[level] ?? widthColumns[0] ?? 6;
}

/// The preview width level: a page outline whose inner text column grows
/// with the level (WidthLevelIcon.swift).
export function widthLevelIcon(level: number): string {
  const column = widthColumn(level);
  return `<svg viewBox="0 0 22 16" width="22" height="16" aria-hidden="true"><rect x="1.6" y="1.6" width="18.8" height="12.8" rx="3" fill="none" stroke="currentColor" stroke-width="1.2"/><rect class="width-column" x="${11 - column / 2}" y="4" width="${column}" height="8" rx="1.5" fill="currentColor"/></svg>`;
}
