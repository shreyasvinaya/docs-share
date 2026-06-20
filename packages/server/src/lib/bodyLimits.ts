import { bodyLimit } from "hono/body-limit";
import type { Context, MiddlewareHandler } from "hono";
import { config } from "./config.js";
import type { AppEnv } from "./types.js";

// ---------------------------------------------------------------------------
// Request body-size limits (memory-DoS guards). Without these, `c.req.json()` /
// `formData()` buffer up to Bun's 128MB default before any per-route size check
// runs. `bodyLimit` rejects oversized requests with 413 BEFORE the handler ever
// reads the body. Limits are config-driven; the backstop on the Bun.serve
// export (`maxRequestBodySize`) catches anything that slips past route matching.
// ---------------------------------------------------------------------------

const bodyTooLarge = (c: Context<AppEnv>) =>
  c.json({ error: "Request body too large" }, 413);

// Public site-data form ingestion (POST /api/sites/:target/data/:collection).
export const ingestionPathRe = /^\/api\/sites\/[^/]+\/data\/[^/]+$/;
// Draft (single HTML document) uploads under /api/drafts.
const draftPathRe = /^\/api\/drafts(\/|$)/;
// Multipart repo-file uploads: POST /api/files/:repoId/upload. These carry real
// document assets and need the larger MAX_FILE_UPLOAD_BYTES cap; without this
// they fall through to the 1MB general default and 413 before the handler.
const fileUploadPathRe = /^\/api\/files\/[^/]+\/upload$/;

/**
 * Build the single `/api/*` body-limit guard. It dispatches to exactly ONE cap
 * per request so the broad default never double-applies a TIGHTER limit on top
 * of a route that has a deliberately LARGER one (a multi-MB draft, or a
 * multi-MB multipart file upload, must not be rejected by the 1MB default).
 * Most specific path wins; the largest appropriate cap is chosen for upload
 * routes so the general cap never shadows them.
 *
 * Read at call time (not module load) so test overrides of `config.*` apply.
 */
export function apiBodyLimit(): MiddlewareHandler<AppEnv> {
  const siteDataIngestionLimit = bodyLimit({
    maxSize: config.MAX_SITE_DATA_BODY_BYTES,
    onError: bodyTooLarge,
  });
  const draftUploadLimit = bodyLimit({
    maxSize: config.MAX_UPLOAD_BYTES,
    onError: bodyTooLarge,
  });
  const fileUploadLimit = bodyLimit({
    maxSize: config.MAX_FILE_UPLOAD_BYTES,
    onError: bodyTooLarge,
  });
  const generalApiLimit = bodyLimit({
    maxSize: config.MAX_JSON_BODY_BYTES,
    onError: bodyTooLarge,
  });

  return (c, next) => {
    if (ingestionPathRe.test(c.req.path)) return siteDataIngestionLimit(c, next);
    if (draftPathRe.test(c.req.path)) return draftUploadLimit(c, next);
    if (fileUploadPathRe.test(c.req.path)) return fileUploadLimit(c, next);
    return generalApiLimit(c, next);
  };
}

/** Body-size guard for git smart-HTTP push/fetch bodies (`/git/*`). */
export function gitBodyLimit(): MiddlewareHandler<AppEnv> {
  return bodyLimit({ maxSize: config.GIT_MAX_BODY_BYTES, onError: bodyTooLarge });
}
