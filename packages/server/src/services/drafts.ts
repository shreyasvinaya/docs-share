import { basename, extname } from "path";

export const DRAFT_PATH_PREFIX = "_drafts";
export const MAX_DRAFT_UPLOAD_BYTES = 10 * 1024 * 1024;

export interface DraftUploadValidation {
  ok: boolean;
  error?: string;
}

const HTML_EXTENSIONS = new Set([".html", ".htm"]);

export function normalizeDraftFilename(fileName: string): string | null {
  const trimmed = fileName.trim();
  if (!trimmed) return null;
  if (basename(trimmed) !== trimmed) return null;
  if (!HTML_EXTENSIONS.has(extname(trimmed).toLowerCase())) return null;
  return trimmed;
}

export function validateDraftUpload(
  fileName: string,
  sizeBytes: number,
  contentType: string | null
): DraftUploadValidation {
  if (!normalizeDraftFilename(fileName)) {
    return {
      ok: false,
      error: "Draft uploads must be .html or .htm files",
    };
  }

  if (sizeBytes > MAX_DRAFT_UPLOAD_BYTES) {
    return {
      ok: false,
      error: "Draft upload exceeds the 10 MB limit",
    };
  }

  if (
    contentType &&
    contentType !== "application/octet-stream" &&
    !contentType.toLowerCase().startsWith("text/html")
  ) {
    return {
      ok: false,
      error: "Draft uploads must be HTML documents",
    };
  }

  return { ok: true };
}

export function buildDraftStoragePath(draftId: string): string {
  return `${DRAFT_PATH_PREFIX}/${draftId}/index.html`;
}

export function extractDraftTitle(html: string, fallbackFileName = "Untitled draft"): string {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const rawTitle = titleMatch?.[1] ?? h1Match?.[1];
  const cleaned = rawTitle ? cleanHtmlText(rawTitle) : "";

  if (cleaned) return cleaned.slice(0, 160);

  const fallback = basename(fallbackFileName).replace(/\.[^.]+$/, "");
  return fallback || "Untitled draft";
}

export function sha256Hex(data: ArrayBuffer): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(data);
  return hasher.digest("hex");
}

export function buildDraftShellHtml(params: {
  title: string;
  contentPath: string;
}): string {
  const title = escapeHtml(params.title);
  const contentPath = escapeHtml(params.contentPath);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    html, body { height: 100%; margin: 0; }
    body {
      background: #030712;
      color: #e5e7eb;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      overflow: hidden;
    }
    .bar {
      align-items: center;
      background: #111827;
      border-bottom: 1px solid #263244;
      display: flex;
      gap: 8px;
      height: 28px;
      padding: 0 10px;
      width: 100%;
    }
    .brand { color: #f9fafb; font-size: 12px; font-weight: 700; }
    .muted { color: #a7b0bf; font-size: 12px; }
    iframe { border: 0; display: block; height: calc(100vh - 28px); width: 100%; }
  </style>
</head>
<body>
  <div class="bar"><span class="brand">Postplan</span><span class="muted">This is a hosted draft.</span></div>
  <iframe src="${contentPath}" title="${title}" sandbox="allow-scripts"></iframe>
</body>
</html>`;
}

export function draftContentSecurityHeaders(): Record<string, string> {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "private, no-store",
    "Content-Security-Policy":
      "sandbox allow-scripts; default-src 'self' data: blob:; script-src 'unsafe-inline' 'unsafe-eval' data: blob:; style-src 'unsafe-inline' data:; img-src 'self' data: blob:;",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  };
}

function cleanHtmlText(value: string): string {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
