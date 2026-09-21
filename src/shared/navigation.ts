import { documentScheme } from "./markdown/content-policy";

/// A frame asking to load a page, as the main process sees it.
export interface FrameNavigation {
  url: string;
  isMainFrame: boolean;
  /// The page the frame sits in; null for a frame with no parent.
  parentURL: string | null;
}

/// Whether a frame may load `url`. Nothing navigates away from the app's
/// own pages: a window's page stays where it is, and the only frame the
/// app's pages hold is the preview's, which loads its own page once. Inside
/// the preview, a document's web embeds (https iframes) load, and a frame
/// nested inside one of those is the embed's business.
export function mayFrameNavigate({ url, isMainFrame, parentURL }: FrameNavigation, appOrigin: string): boolean {
  if (isMainFrame) return false;
  const previewPage = `${documentScheme}://`;
  if (url.startsWith(previewPage) && url.endsWith("/.lauda-preview")) return true;
  if (parentURL === null) return false;
  if (parentURL.startsWith(previewPage)) return url.startsWith("https://");
  return !parentURL.startsWith(appOrigin);
}
