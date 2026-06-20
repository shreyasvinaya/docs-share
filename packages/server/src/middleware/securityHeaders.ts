import { secureHeaders } from "hono/secure-headers";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../lib/types.js";

/**
 * Whether a request path is served by the `/view` routes (a worktree/share
 * file or directory index).
 */
function isViewPath(path: string): boolean {
  return path === "/view" || path.startsWith("/view/");
}

/**
 * Global security-headers middleware that applies a CORP `cross-origin`
 * override to `/view/*` responses while keeping Hono's `same-origin` default
 * everywhere else.
 *
 * WHY `/view` needs `cross-origin`: served HTML/SVG/XHTML documents run in an
 * OPAQUE ORIGIN (the sandbox CSP in routes/view.ts never grants
 * `allow-same-origin`). RELATIVE to that opaque document, its OWN sibling
 * sub-resources (`app.js`, `app.css`, images) are cross-origin, so a CORP of
 * `same-origin` makes the browser BLOCK them and breaks legitimate multi-file
 * bundles in production. `cross-origin` lets the document load its own assets.
 *
 * WHY this is SAFE for private content: `/view/:repoId/*` requires the
 * host-only, SameSite=Lax `ds_session` cookie and `requireAuth` runs BEFORE the
 * file is served. A third-party page embedding a private asset cross-site sends
 * no cookie and is rejected with 401, so CORP `cross-origin` only ever relaxes
 * a response the caller was already authorized to receive.
 *
 * WHY it must live in the middleware (not just per-response in serveFile):
 * `secureHeaders()` rewrites every managed header with `headers.set(...)` AFTER
 * the handler returns, so any CORP set on the Response inside serveFile would be
 * clobbered back to `same-origin`. Choosing the middleware variant by path is
 * what actually sticks.
 */
export function viewAwareSecureHeaders() {
  const defaultHeaders = secureHeaders();
  const viewHeaders = secureHeaders({
    crossOriginResourcePolicy: "cross-origin",
  });

  return createMiddleware<AppEnv>((c, next) =>
    isViewPath(c.req.path) ? viewHeaders(c, next) : defaultHeaders(c, next)
  );
}
