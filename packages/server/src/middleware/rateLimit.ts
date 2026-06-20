import { createMiddleware } from "hono/factory";
import type { Context } from "hono";
import type { AppEnv } from "../lib/types.js";

export interface RateLimitOptions {
  /** Maximum number of requests permitted per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Label used to namespace buckets so multiple limiters never collide. */
  name: string;
  /** When false, the middleware is a no-op (useful for tests/local dev). */
  enabled?: boolean;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

// In-memory fixed-window store. Keyed by `${name}:${client}`. This is a single
// process store; horizontally-scaled deployments should sit behind a shared
// limiter at the reverse proxy (documented in docs/self-hosting.md).
const store = new Map<string, Bucket>();

/** Test-only helper to clear the shared store between cases. */
export function __resetRateLimitStore(): void {
  store.clear();
}

/**
 * Derive a stable client identifier. Authenticated API-token callers are keyed
 * by their token id so a single noisy token cannot exhaust a shared NAT IP's
 * budget (and vice versa). Everyone else is keyed by their originating IP,
 * taken from the first hop of X-Forwarded-For when behind a reverse proxy.
 */
function clientKey(c: Context<AppEnv>): string {
  const tokenId = c.get("tokenId");
  if (tokenId) return `token:${tokenId}`;

  const forwarded = c.req.header("X-Forwarded-For");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return `ip:${first}`;
  }

  const realIp = c.req.header("X-Real-IP")?.trim();
  if (realIp) return `ip:${realIp}`;

  return "ip:unknown";
}

export function createRateLimiter(options: RateLimitOptions) {
  const { limit, windowMs, name, enabled = true, now = Date.now } = options;

  return createMiddleware<AppEnv>(async (c, next) => {
    if (!enabled) return next();

    const key = `${name}:${clientKey(c)}`;
    const timestamp = now();
    const bucket = store.get(key);

    if (!bucket || bucket.resetAt <= timestamp) {
      store.set(key, { count: 1, resetAt: timestamp + windowMs });
      return next();
    }

    if (bucket.count >= limit) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - timestamp) / 1000));
      c.header("Retry-After", String(retryAfter));
      return c.json(
        { error: "Too many requests. Please slow down and try again shortly." },
        429
      );
    }

    bucket.count += 1;
    return next();
  });
}
