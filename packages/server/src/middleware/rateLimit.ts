import { createMiddleware } from "hono/factory";
import { getConnInfo } from "hono/bun";
import type { Context } from "hono";
import type { AppEnv } from "../lib/types.js";
import { config } from "../lib/config.js";

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
  /**
   * Trust a reverse proxy to report the real client IP via `X-Real-IP`.
   * Defaults to `config.TRUST_PROXY`. Overridable for tests.
   */
  trustProxy?: boolean;
  /** Hard cap on distinct buckets. Defaults to `config.RATE_LIMIT_MAX_ENTRIES`. */
  maxEntries?: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

// In-memory fixed-window store. Keyed by `${name}:${client}`. This is a single
// process store; horizontally-scaled deployments should sit behind a shared
// limiter at the reverse proxy (documented in docs/self-hosting.md).
//
// The store is bounded two ways so a flood of distinct keys (e.g. many client
// IPs) cannot exhaust memory:
//   1. Expired buckets are reclaimed lazily on each request and via a periodic
//      sweep amortised over requests.
//   2. A hard `maxEntries` cap evicts expired-or-oldest buckets when exceeded.
const store = new Map<string, Bucket>();

// Amortised periodic sweep: every Nth request we walk the store once and drop
// every bucket whose window has elapsed. Cheap, allocation-free, and needs no
// timers (which are awkward to unref/clean up across the test runner).
const SWEEP_EVERY_REQUESTS = 1000;
let requestsSinceSweep = 0;

/** Drop every bucket whose window has already elapsed. */
function sweepExpired(timestamp: number): void {
  for (const [key, bucket] of store) {
    if (bucket.resetAt <= timestamp) store.delete(key);
  }
}

/**
 * Enforce the hard entry cap. Map preserves insertion order, so iterating and
 * evicting from the front removes the oldest buckets first. We prefer evicting
 * already-expired buckets, then fall back to the oldest live ones.
 */
function enforceMaxEntries(maxEntries: number, timestamp: number): void {
  if (store.size <= maxEntries) return;
  sweepExpired(timestamp);
  // Still over the cap after reclaiming expired entries: evict oldest-first.
  for (const key of store.keys()) {
    if (store.size <= maxEntries) break;
    store.delete(key);
  }
}

/** Test-only helper to clear the shared store between cases. */
export function __resetRateLimitStore(): void {
  store.clear();
  requestsSinceSweep = 0;
}

/** Test-only helper to inspect the current number of live buckets. */
export function __rateLimitStoreSize(): number {
  return store.size;
}

/**
 * Resolve the IP used to key untrusted (non-token) callers.
 *
 * Trusted-proxy model:
 *  - `trustProxy === true`: the IP is taken ONLY from `X-Real-IP`, which the
 *    proxy is required to OVERWRITE with the real socket address. We never
 *    trust the client-appended first hop of `X-Forwarded-For`, because a
 *    client can forge that header to mint a fresh bucket and bypass the limit.
 *  - `trustProxy === false`: ALL forwarded headers are ignored. We key on the
 *    actual socket peer address obtained from the Bun server via
 *    `getConnInfo(c)` (which calls `server.requestIP(c.req.raw)`).
 *
 * If the socket address is genuinely unavailable (e.g. no Bun server in the
 * fetch env, as in unit tests), we fall back to a single fixed bucket so
 * untrusted requests share one conservative limit rather than each getting a
 * spoofable, independent budget.
 */
function clientIp(c: Context<AppEnv>, trustProxy: boolean): string {
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

/**
 * Derive a stable client identifier. Authenticated API-token callers are keyed
 * by their token id so a single noisy token cannot exhaust a shared NAT IP's
 * budget (and vice versa). Everyone else is keyed by a non-spoofable client IP.
 */
function clientKey(c: Context<AppEnv>, trustProxy: boolean): string {
  const tokenId = c.get("tokenId");
  if (tokenId) return `token:${tokenId}`;
  return `ip:${clientIp(c, trustProxy)}`;
}

export function createRateLimiter(options: RateLimitOptions) {
  const {
    limit,
    windowMs,
    name,
    enabled = true,
    now = Date.now,
    trustProxy = config.TRUST_PROXY,
    maxEntries = config.RATE_LIMIT_MAX_ENTRIES,
  } = options;

  return createMiddleware<AppEnv>(async (c, next) => {
    if (!enabled) return next();

    const key = `${name}:${clientKey(c, trustProxy)}`;
    const timestamp = now();

    // Amortised periodic sweep to reclaim expired buckets store-wide.
    if (++requestsSinceSweep >= SWEEP_EVERY_REQUESTS) {
      requestsSinceSweep = 0;
      sweepExpired(timestamp);
    }

    const bucket = store.get(key);

    if (!bucket || bucket.resetAt <= timestamp) {
      // Reclaim this expired bucket (if any) and re-insert so it moves to the
      // back of the Map's insertion order (newest), keeping eviction LRU-ish.
      store.delete(key);
      store.set(key, { count: 1, resetAt: timestamp + windowMs });
      enforceMaxEntries(maxEntries, timestamp);
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
