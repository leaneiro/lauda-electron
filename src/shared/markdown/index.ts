// Markdown to preview HTML, as the native app renders it: the parser, the
// renderer, the code highlighter, the outline, source-line arithmetic and
// the pages' policies. Pure TypeScript, so it runs in the render worker, the
// main process and tests alike.

export {
  render,
  renderWithLines,
  renderForPrint,
  isAllowedLinkDestination,
  codeBlockLineCount,
  compactCodeBlockLineLimit,
  type RenderOptions,
  type RenderedDocument,
} from "./renderer";
export { escapeHTML } from "./escape";
export { highlightCode } from "./code-highlighter";
export { outlineItems, outlineTitle, type OutlineItem } from "./outline";
export { sourceLineCount } from "./source-lines";
export {
  previewContentSecurityPolicy,
  exportContentSecurityPolicy,
  wordmarkFontFace,
  previewStyles,
  standalone,
  type StandaloneOptions,
} from "./template";
export { allowedLinkSchemes, documentScheme, imageFileExtensions, isImagePath } from "./content-policy";
export { parseDocument } from "./parser";
export { childrenOf, plainText } from "./markup";
export type * from "./markup";
