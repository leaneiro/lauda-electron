// Markdown to preview HTML, as the native app renders it: the parser, the
// renderer, the code highlighter, the outline, source-line arithmetic and
// the pages' policies. Pure TypeScript, so it runs in the render worker, the
// main process and tests alike.

export { highlightCode } from "./code-highlighter";
export { allowedLinkSchemes, documentScheme, imageFileExtensions, isImagePath } from "./content-policy";
export { escapeHTML } from "./escape";
export type * from "./markup";
export { childrenOf, plainText } from "./markup";
export { type OutlineItem, outlineItems, outlineTitle } from "./outline";
export { parseDocument } from "./parser";
export {
  codeBlockLineCount,
  compactCodeBlockLineLimit,
  isAllowedLinkDestination,
  type RenderedDocument,
  type RenderOptions,
  render,
  renderForPrint,
  renderWithLines,
} from "./renderer";
export { sourceLineCount } from "./source-lines";
export {
  exportContentSecurityPolicy,
  previewContentSecurityPolicy,
  previewStyles,
  type StandaloneOptions,
  standalone,
  wordmarkFontFace,
} from "./template";
