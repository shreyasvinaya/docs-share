import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { config } from "../lib/config.js";
import type { AppEnv } from "../lib/types.js";
import internalRoutes, { timingSafeEqualStr } from "./internal.js";

const app = new Hono<AppEnv>();
app.route("/internal", internalRoutes);

describe("timingSafeEqualStr (FIX 6)", () => {
  test("returns true for identical strings", () => {
    expect(timingSafeEqualStr("hunter2-long-secret", "hunter2-long-secret")).toBe(
      true
    );
  });

  test("returns false for differing strings of equal length", () => {
    expect(timingSafeEqualStr("aaaaaaaa", "aaaaaaab")).toBe(false);
  });

  test("returns false for differing-length strings (no throw)", () => {
    expect(timingSafeEqualStr("short", "a-much-longer-secret")).toBe(false);
  });

  test("returns false for a missing header value", () => {
    expect(timingSafeEqualStr(undefined, "secret")).toBe(false);
    expect(timingSafeEqualStr(null, "secret")).toBe(false);
  });
});

describe("POST /internal/hooks/post-receive secret check (FIX 6)", () => {
  test("rejects a wrong secret with 403", async () => {
    const res = await app.request("/internal/hooks/post-receive", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hook-Secret": "definitely-not-the-secret",
      },
      body: JSON.stringify({
        repoPath: "/tmp/does-not-exist.git",
        ref: "refs/heads/main",
        oldRev: "0".repeat(40),
        newRev: "a".repeat(40),
      }),
    });
    expect(res.status).toBe(403);
  });

  test("accepts the correct secret (passes auth, then 404 for unknown repo)", async () => {
    const res = await app.request("/internal/hooks/post-receive", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hook-Secret": config.HOOK_SECRET,
      },
      body: JSON.stringify({
        repoPath: "/tmp/unknown-repo-for-test.git",
        ref: "refs/heads/main",
        oldRev: "0".repeat(40),
        newRev: "a".repeat(40),
      }),
    });
    // The secret was accepted (not 403). The repo lookup then fails with 404,
    // proving auth passed.
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(404);
  });
});
