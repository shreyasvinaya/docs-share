import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import {
  createRateLimiter,
  __resetRateLimitStore,
  __rateLimitStoreSize,
} from "./rateLimit.js";
import type { AppEnv } from "../lib/types.js";

type Options = Parameters<typeof createRateLimiter>[0];

function appWithLimiter(options: Options) {
  const app = new Hono<AppEnv>();
  app.use("*", createRateLimiter(options));
  app.get("/", (c) => c.json({ ok: true }));
  return app;
}

/** Simulate a request behind a trusted proxy that set X-Real-IP. */
function fromRealIp(ip: string): RequestInit {
  return { headers: { "X-Real-IP": ip } };
}

describe("createRateLimiter (trusted proxy)", () => {
  test("allows requests under the limit and blocks the overflow with 429", async () => {
    __resetRateLimitStore();
    const app = appWithLimiter({
      limit: 2,
      windowMs: 60_000,
      name: "test",
      trustProxy: true,
    });

    const first = await app.request("/", fromRealIp("203.0.113.1"));
    const second = await app.request("/", fromRealIp("203.0.113.1"));
    const third = await app.request("/", fromRealIp("203.0.113.1"));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);
    expect((await third.json()) as { error: string }).toEqual({
      error: "Too many requests. Please slow down and try again shortly.",
    });
    expect(third.headers.get("Retry-After")).toBeTruthy();
  });

  test("tracks separate buckets per X-Real-IP", async () => {
    __resetRateLimitStore();
    const app = appWithLimiter({
      limit: 1,
      windowMs: 60_000,
      name: "test",
      trustProxy: true,
    });

    expect((await app.request("/", fromRealIp("198.51.100.1"))).status).toBe(200);
    expect((await app.request("/", fromRealIp("198.51.100.1"))).status).toBe(429);
    // A different proxy-reported IP still has its own fresh budget.
    expect((await app.request("/", fromRealIp("198.51.100.2"))).status).toBe(200);
  });

  test("refills the budget once the window elapses", async () => {
    __resetRateLimitStore();
    let now = 1_000_000;
    const app = appWithLimiter({
      limit: 1,
      windowMs: 1_000,
      name: "test",
      trustProxy: true,
      now: () => now,
    });

    expect((await app.request("/", fromRealIp("192.0.2.1"))).status).toBe(200);
    expect((await app.request("/", fromRealIp("192.0.2.1"))).status).toBe(429);

    now += 1_001;
    expect((await app.request("/", fromRealIp("192.0.2.1"))).status).toBe(200);
  });

  test("keys authenticated callers by token id when available", async () => {
    __resetRateLimitStore();
    const app = new Hono<AppEnv>();
    app.use("*", (c, next) => {
      const tokenId = c.req.header("X-Test-Token");
      if (tokenId) {
        c.set("userId", "user_1");
        c.set("authMethod", "api_token");
        c.set("tokenId", tokenId);
      }
      return next();
    });
    app.use(
      "*",
      createRateLimiter({ limit: 1, windowMs: 60_000, name: "test", trustProxy: true })
    );
    app.get("/", (c) => c.json({ ok: true }));

    const headers = (token: string): RequestInit => ({
      headers: { "X-Real-IP": "203.0.113.50", "X-Test-Token": token },
    });

    // Same IP, but two distinct tokens get independent budgets.
    expect((await app.request("/", headers("tok_a"))).status).toBe(200);
    expect((await app.request("/", headers("tok_a"))).status).toBe(429);
    expect((await app.request("/", headers("tok_b"))).status).toBe(200);
  });

  test("can be disabled via the enabled flag", async () => {
    __resetRateLimitStore();
    const app = appWithLimiter({
      limit: 1,
      windowMs: 60_000,
      name: "test",
      enabled: false,
      trustProxy: true,
    });

    expect((await app.request("/", fromRealIp("203.0.113.7"))).status).toBe(200);
    expect((await app.request("/", fromRealIp("203.0.113.7"))).status).toBe(200);
  });
});

describe("createRateLimiter (IP spoofing resistance)", () => {
  test("trusted proxy: a spoofed X-Forwarded-For cannot mint a fresh bucket", async () => {
    __resetRateLimitStore();
    const app = appWithLimiter({
      limit: 1,
      windowMs: 60_000,
      name: "test",
      trustProxy: true,
    });

    // The proxy authoritatively reports the same client via X-Real-IP, while a
    // malicious client rotates X-Forwarded-For trying to dodge the limit.
    const spoof = (xff: string): RequestInit => ({
      headers: { "X-Real-IP": "203.0.113.99", "X-Forwarded-For": xff },
    });

    expect((await app.request("/", spoof("1.1.1.1"))).status).toBe(200);
    // Different forged X-Forwarded-For values MUST still hit the same bucket.
    expect((await app.request("/", spoof("2.2.2.2"))).status).toBe(429);
    expect((await app.request("/", spoof("3.3.3.3, 4.4.4.4"))).status).toBe(429);
  });

  test("untrusted: X-Forwarded-For AND X-Real-IP are ignored, all share one bucket", async () => {
    __resetRateLimitStore();
    // trustProxy=false and no Bun server in app.request() => socket address is
    // unavailable, so every untrusted caller shares the single "unknown" bucket.
    const app = appWithLimiter({
      limit: 1,
      windowMs: 60_000,
      name: "test",
      trustProxy: false,
    });

    const spoof = (ip: string): RequestInit => ({
      headers: { "X-Forwarded-For": ip, "X-Real-IP": ip },
    });

    // First request consumes the shared bucket.
    expect((await app.request("/", spoof("5.5.5.5"))).status).toBe(200);
    // A spoofed X-Forwarded-For cannot create a fresh bucket...
    expect((await app.request("/", spoof("6.6.6.6"))).status).toBe(429);
    // ...and neither can a spoofed X-Real-IP when the proxy is not trusted.
    expect((await app.request("/", spoof("7.7.7.7"))).status).toBe(429);
    // Only one bucket exists for all of them.
    expect(__rateLimitStoreSize()).toBe(1);
  });
});

describe("createRateLimiter (bounded store)", () => {
  test("reclaims expired buckets so the store does not grow without bound", async () => {
    __resetRateLimitStore();
    let now = 0;
    const app = appWithLimiter({
      limit: 5,
      windowMs: 1_000,
      name: "sweep",
      trustProxy: true,
      now: () => now,
    });

    // Create 50 distinct buckets in window 1.
    for (let i = 0; i < 50; i++) {
      await app.request("/", fromRealIp(`10.0.0.${i}`));
    }
    expect(__rateLimitStoreSize()).toBe(50);

    // Advance past the window; every existing bucket is now expired. A single
    // new request for a fresh key should reclaim the expired entry it touches,
    // and the next distinct request triggers re-use rather than unbounded growth.
    now += 2_000;
    // Touch a brand new key — its own stale entry (none) plus lazy delete keeps
    // size from climbing past the live set.
    await app.request("/", fromRealIp("10.0.1.1"));

    // Re-request all original keys: each is expired, so each is reclaimed and
    // re-inserted (net zero growth per key), not duplicated.
    for (let i = 0; i < 50; i++) {
      await app.request("/", fromRealIp(`10.0.0.${i}`));
    }
    // 50 reused keys + 1 new key = 51, NOT 100. Expired entries were reclaimed.
    expect(__rateLimitStoreSize()).toBe(51);
  });

  test("enforces a hard maximum entry count via eviction", async () => {
    __resetRateLimitStore();
    const maxEntries = 10;
    const app = appWithLimiter({
      limit: 5,
      windowMs: 600_000,
      name: "cap",
      trustProxy: true,
      maxEntries,
    });

    // Push well past the cap with distinct (live) IPs.
    for (let i = 0; i < 100; i++) {
      await app.request("/", fromRealIp(`172.16.0.${i}`));
    }

    // The store is capped — it never exceeds maxEntries despite 100 distinct IPs.
    expect(__rateLimitStoreSize()).toBeLessThanOrEqual(maxEntries);
  });
});
