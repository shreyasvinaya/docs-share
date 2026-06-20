import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { requireSession } from "./requireSession.js";
import type { AppEnv } from "../lib/types.js";

/**
 * requireSession must allow only cookie-session callers and reject API tokens.
 * We pre-seed `authMethod` to exercise both branches in isolation (the real
 * value is set by sessionMiddleware/requireAuth upstream).
 */
function appFor(authMethod: "session" | "api_token" | null) {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    if (authMethod !== null) c.set("authMethod", authMethod);
    await next();
  });
  app.get("/probe", requireSession, (c) => c.json({ ok: true }));
  return app;
}

describe("requireSession", () => {
  test("allows a session-authenticated request", async () => {
    const res = await appFor("session").request("/probe");
    expect(res.status).toBe(200);
  });

  test("rejects an api_token request with 403", async () => {
    const res = await appFor("api_token").request("/probe");
    expect(res.status).toBe(403);
  });

  test("rejects a request with no auth method with 403", async () => {
    const res = await appFor(null).request("/probe");
    expect(res.status).toBe(403);
  });
});
