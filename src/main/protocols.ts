import { app, protocol } from "electron";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { resolveDocumentFile } from "./document-files";
import { previewStylesheet } from "./preview-styles";
import { exportContentSecurityPolicy, previewContentSecurityPolicy } from "../shared/markdown";

export const appScheme = "lauda-app";
export const documentScheme = "lauda-doc";
export const appOrigin = `${appScheme}://app`;

/// Must run before the app is ready: both schemes behave like https
/// (standard URLs, a secure context), which relative URLs and the preview's
/// Content-Security-Policy rely on.
export function registerSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: appScheme, privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } },
    { scheme: documentScheme, privileges: { standard: true, secure: true } },
  ]);
}

const mimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".heic": "image/heic",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".md": "text/markdown; charset=utf-8",
};

function contentType(file: string): string {
  return mimeTypes[extname(file).toLowerCase()] ?? "application/octet-stream";
}

export const distDirectory = join(app.getAppPath(), "dist");

/// The folder each open document's preview may read images from, keyed by
/// an unguessable token that names the preview's origin.
const documentFolders = new Map<string, string | null>();
const tokensByDocument = new Map<string, string>();
/// Pages made for a PDF export, served once from the document's folder so
/// their relative images resolve.
const exportPages = new Map<string, { folder: string | null; html: string }>();

export function registerDocumentFolder(documentId: string, folder: string | null): string {
  let token = tokensByDocument.get(documentId);
  if (!token) {
    token = randomUUID();
    tokensByDocument.set(documentId, token);
  }
  documentFolders.set(token, folder);
  return token;
}

export function forgetDocumentFolder(documentId: string): void {
  const token = tokensByDocument.get(documentId);
  if (token) documentFolders.delete(token);
  tokensByDocument.delete(documentId);
}

/// Serves a page for a PDF export from `folder` and returns its URL.
export function serveExportPage(folder: string | null, html: string): { url: string; done: () => void } {
  const token = randomUUID();
  exportPages.set(token, { folder, html });
  documentFolders.set(token, folder);
  return {
    url: `${documentScheme}://${token}/.lauda-export`,
    done: () => {
      exportPages.delete(token);
      documentFolders.delete(token);
    },
  };
}

/// The live preview's page. Like the native one it carries no document
/// script: the app's script comes from the app's own scheme, the only
/// source the policy allows, and the document's raw HTML can't run any.
let previewPage: string | undefined;
function previewPageHTML(locale: string): string {
  previewPage ??= `<!DOCTYPE html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<style>
${previewStylesheet(distDirectory)}
</style>
</head>
<body>
<article id="content"></article>
<script src="${appOrigin}/preview/preview.js"></script>
</body>
</html>`;
  return previewPage;
}

export function handleProtocols(locale: string): void {
  protocol.handle(appScheme, async (request) => {
    const url = new URL(request.url);
    if (url.host !== "app") return new Response(null, { status: 404 });
    const file = resolve(distDirectory, "." + decodeURIComponent(url.pathname));
    if (!file.startsWith(distDirectory + sep)) return new Response(null, { status: 403 });
    try {
      const body = await readFile(file);
      return new Response(body, { headers: { "content-type": contentType(file) } });
    } catch {
      return new Response(null, { status: 404 });
    }
  });

  protocol.handle(documentScheme, async (request) => {
    const url = new URL(request.url);
    const token = url.host;
    if (url.pathname === "/.lauda-preview" && documentFolders.has(token)) {
      return new Response(previewPageHTML(locale), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy": `${previewContentSecurityPolicy}; script-src ${appOrigin}`,
        },
      });
    }
    const page = exportPages.get(token);
    if (url.pathname === "/.lauda-export" && page) {
      return new Response(page.html, {
        headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": exportContentSecurityPolicy },
      });
    }
    const folder = documentFolders.get(token);
    const file = folder ? resolveDocumentFile(folder, url.pathname) : null;
    if (!file) return new Response(null, { status: 404 });
    try {
      return new Response(await readFile(file), { headers: { "content-type": contentType(file) } });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}
