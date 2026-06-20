import { describe, expect, test } from "bun:test";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { config } from "./config.js";
import type { AppEnv } from "./types.js";

/**
 * These tests exercise the SAME `bodyLimit` wiring that `index.ts` installs:
 * a tight cap on the public site-data ingestion path, the general API default,
 * and the git smart-HTTP cap. They prove an oversized body is rejected with 413
 * BEFORE any handler reads it (the handler below would otherwise echo the body).
 */
const bodyTooLarge = (c: Context<AppEnv>) =>
  c.json({ error: "Request body too large" }, 413);

const ingestionPathRe = /^\/api\/sites\/[^/]+\/data\/[^/]+$/;

function buildApp(gitMaxBodyBytes = config.GIT_MAX_BODY_BYTES): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  const siteDataIngestionLimit = bodyLimit({
    maxSize: config.MAX_SITE_DATA_BODY_BYTES,
    onError: bodyTooLarge,
  });
  const generalApiLimit = bodyLimit({
    maxSize: config.MAX_JSON_BODY_BYTES,
    onError: bodyTooLarge,
  });

  app.use("/api/*", (c, next) => {
    if (ingestionPathRe.test(c.req.path)) return siteDataIngestionLimit(c, next);
    return generalApiLimit(c, next);
  });
  app.use(
    "/git/*",
    bodyLimit({ maxSize: gitMaxBodyBytes, onError: bodyTooLarge })
  );

  // A handler that only succeeds if it actually got to read the body. If the
  // limit rejected the request first, this never runs.
  let parsedCalls = 0;
  app.post("/api/sites/draft:abc/data/contact", async (c) => {
    parsedCalls += 1;
    await c.req.json().catch(() => ({}));
    return c.json({ parsed: true });
  });
  app.post("/api/echo", async (c) => {
    parsedCalls += 1;
    await c.req.json().catch(() => ({}));
    return c.json({ parsed: true });
  });
  app.post("/git/some/receive-pack", async (c) => {
    parsedCalls += 1;
    await c.req.arrayBuffer();
    return c.json({ parsed: true });
  });
  // Expose the parse counter for assertions.
  app.get("/__parsed", (c) => c.json({ parsedCalls }));

  return app;
}

function jsonBody(bytes: number): string {
  // Build a JSON object whose serialized form is >= `bytes`.
  return JSON.stringify({ blob: "x".repeat(bytes) });
}

describe("ingestion body limit (FIX 2)", () => {
  test("rejects an oversized ingestion body with 413 before parsing", async () => {
    const app = buildApp();
    const res = await app.request("/api/sites/draft:abc/data/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: jsonBody(config.MAX_SITE_DATA_BODY_BYTES + 1024),
    });
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Request body too large");

    // The handler must not have parsed anything.
    const parsed = await (await app.request("/__parsed")).json();
    expect((parsed as { parsedCalls: number }).parsedCalls).toBe(0);
  });

  test("accepts a small ingestion body", async () => {
    const app = buildApp();
    const res = await app.request("/api/sites/draft:abc/data/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@b.com" }),
    });
    expect(res.status).toBe(200);
  });
});

describe("general API body limit (FIX 2)", () => {
  test("rejects a json body over the general limit with 413", async () => {
    const app = buildApp();
    const res = await app.request("/api/echo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: jsonBody(config.MAX_JSON_BODY_BYTES + 1024),
    });
    expect(res.status).toBe(413);
  });
});

describe("git smart-HTTP body limit (FIX 3)", () => {
  test("rejects an oversized git body with 413 before buffering", async () => {
    // Use a small cap so the test can send a real over-cap body cheaply rather
    // than materializing 100MB; the wiring is identical to production.
    const app = buildApp(64);
    const res = await app.request("/git/some/receive-pack", {
      method: "POST",
      headers: { "Content-Type": "application/x-git-receive-pack-request" },
      body: "x".repeat(128),
    });
    expect(res.status).toBe(413);

    const parsed = await (await app.request("/__parsed")).json();
    expect((parsed as { parsedCalls: number }).parsedCalls).toBe(0);
  });

  test("accepts a git body within the cap", async () => {
    const app = buildApp(64);
    const res = await app.request("/git/some/receive-pack", {
      method: "POST",
      headers: { "Content-Type": "application/x-git-receive-pack-request" },
      body: "x".repeat(8),
    });
    expect(res.status).toBe(200);
  });
});
