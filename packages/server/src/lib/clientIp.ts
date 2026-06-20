import { getConnInfo } from "hono/bun";
import type { Context } from "hono";
import type { AppEnv } from "./types.js";
import { config } from "./config.js";

/**
 * Resolve a trusted client IP for keying untrusted (non-authenticated) callers
 * such as rate limiters and the public site-data ingestion endpoint.
 *
 * Trusted-proxy model:
 *  - `trustProxy === true`: the IP is taken ONLY from `X-Real-IP`, which the
 *    proxy is required to OVERWRITE with the real socket address. We never
 *    trust the client-appended first hop of `X-Forwarded-For`, because a client
 *    can forge that header to mint a fresh bucket and bypass per-visitor limits.
 *  - `trustProxy === false`: ALL forwarded headers are ignored. We key on the
 *    actual socket peer address obtained from the Bun server via `getConnInfo(c)`
 *    (which calls `server.requestIP(c.req.raw)`).
 *
 * If the socket address is genuinely unavailable (e.g. no Bun server in the
 * fetch env, as in unit tests), we fall back to a single fixed bucket
 * ("unknown") so untrusted requests share one conservative limit rather than
 * each getting a spoofable, independent budget.
 *
 * @param c - Hono request context.
 * @param trustProxy - Whether a reverse proxy is trusted. Defaults to
 *   `config.TRUST_PROXY`. Overridable for tests.
 * @returns A non-spoofable client identifier, or `"unknown"` when none is
 *   available.
 */
export function resolveClientIp(
  c: Context<AppEnv>,
  trustProxy: boolean = config.TRUST_PROXY
): string {
  if (trustProxy) {
    // X-Real-IP is a single authoritative value set by the proxy. We do NOT
    // read X-Forwarded-For: its first hop is client-controlled and spoofable.
    const realIp = c.req.header("X-Real-IP")?.trim();
    if (realIp) return realIp;
    // Proxy promised a value but didn't send one — share a single bucket
    // rather than trusting a forgeable header.
    return "unknown";
  }

  // Untrusted: ignore every forwarded header and use the real socket address.
  try {
    const address = getConnInfo(c).remote.address?.trim();
    if (address) return address;
  } catch {
    // No Bun server in the fetch env (e.g. tests). Fall through.
  }
  return "unknown";
}
