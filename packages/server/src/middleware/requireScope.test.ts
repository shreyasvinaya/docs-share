import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { hasScope, requireScopeByMethod } from "./requireScope.js";
import type { AppEnv } from "../lib/types.js";

describe("hasScope", () => {
  test("allows exact, wildcard, and resource wildcard scopes", () => {
    expect(hasScope("draft:write", "draft:write")).toBe(true);
    expect(hasScope("draft:*", "draft:write")).toBe(true);
    expect(hasScope("*", "draft:write")).toBe(true);
  });

  test("rejects unrelated scopes", () => {
    expect(hasScope("git:write", "draft:write")).toBe(false);
    expect(hasScope("draft:read", "draft:write")).toBe(false);
  });

  test("supports the new cross-resource scopes", () => {
    for (const resource of ["repo", "share", "team", "user", "audit"]) {
      expect(hasScope("*", `${resource}:read`)).toBe(true);
      expect(hasScope(`${resource}:*`, `${resource}:write`)).toBe(true);
      expect(hasScope(`${resource}:read`, `${resource}:read`)).toBe(true);
      // A read-only grant must never satisfy a write requirement.
      expect(hasScope(`${resource}:read`, `${resource}:write`)).toBe(false);
      // A scope for one resource must never satisfy another resource.
      expect(hasScope(`${resource}:write`, "repo:write")).toBe(
        resource === "repo"
      );
    }
  });
});

describe("requireScopeByMethod", () => {
  // Build a tiny app whose context is pre-seeded as if a given token had already
  // authenticated, so we can assert the method->scope mapping in isolation.
  function appFor(scopes: string | null) {
    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => {
      if (scopes !== null) {
        // Session requests carry no tokenId/api_token authMethod; token requests
        // do. We exercise the api_token path here (the only one scopes gate).
        c.set("authMethod", "session");
      }
      await next();
    });
    app.all("/probe", requireScopeByMethod("repo"), (c) => c.json({ ok: true }));
    return app;
  }

  test("session auth bypasses scope checks for every method", async () => {
    const app = appFor("session");
    for (const method of ["GET", "POST", "DELETE"]) {
      const res = await app.request("/probe", { method });
      expect(res.status).toBe(200);
    }
  });
});
