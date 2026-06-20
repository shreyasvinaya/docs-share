import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createRateLimiter, __resetRateLimitStore } from "./rateLimit.js";
import type { AppEnv } from "../lib/types.js";

function appWithLimiter(options: Parameters<typeof createRateLimiter>[0]) {
  const app = new Hono<AppEnv>();
  app.use("*", createRateLimiter(options));
  app.get("/", (c) => c.json({ ok: true }));
  return app;
}

function fromIp(ip: string): RequestInit {
  return { headers: { "X-Forwarded-For": ip } };
}

describe("createRateLimiter", () => {
  test("allows requests under the limit and blocks the overflow with 429", async () => {
    __resetRateLimitStore();
    const app = appWithLimiter({ limit: 2, windowMs: 60_000, name: "test" });

    const first = await app.request("/", fromIp("203.0.113.1"));
    const second = await app.request("/", fromIp("203.0.113.1"));
    const third = await app.request("/", fromIp("203.0.113.1"));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);
    expect((await third.json()) as { error: string }).toEqual({
      error: "Too many requests. Please slow down and try again shortly.",
    });
    expect(third.headers.get("Retry-After")).toBeTruthy();
  });

  test("tracks separate buckets per client IP", async () => {
    __resetRateLimitStore();
    const app = appWithLimiter({ limit: 1, windowMs: 60_000, name: "test" });

    expect((await app.request("/", fromIp("198.51.100.1"))).status).toBe(200);
    expect((await app.request("/", fromIp("198.51.100.1"))).status).toBe(429);
    // A different IP still has its own fresh budget.
    expect((await app.request("/", fromIp("198.51.100.2"))).status).toBe(200);
  });

  test("uses the first hop of X-Forwarded-For", async () => {
    __resetRateLimitStore();
    const app = appWithLimiter({ limit: 1, windowMs: 60_000, name: "test" });

    expect(
      (await app.request("/", fromIp("203.0.113.9, 10.0.0.1"))).status
    ).toBe(200);
    expect(
      (await app.request("/", fromIp("203.0.113.9, 10.0.0.5"))).status
    ).toBe(429);
  });

  test("refills the budget once the window elapses", async () => {
    __resetRateLimitStore();
    let now = 1_000_000;
    const app = appWithLimiter({
      limit: 1,
      windowMs: 1_000,
      name: "test",
      now: () => now,
    });

    expect((await app.request("/", fromIp("192.0.2.1"))).status).toBe(200);
    expect((await app.request("/", fromIp("192.0.2.1"))).status).toBe(429);

    now += 1_001;
    expect((await app.request("/", fromIp("192.0.2.1"))).status).toBe(200);
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
    app.use("*", createRateLimiter({ limit: 1, windowMs: 60_000, name: "test" }));
    app.get("/", (c) => c.json({ ok: true }));

    const headers = (token: string): RequestInit => ({
      headers: { "X-Forwarded-For": "203.0.113.50", "X-Test-Token": token },
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
    });

    expect((await app.request("/", fromIp("203.0.113.7"))).status).toBe(200);
    expect((await app.request("/", fromIp("203.0.113.7"))).status).toBe(200);
  });
});
