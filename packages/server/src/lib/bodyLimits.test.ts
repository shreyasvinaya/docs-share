import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { config } from "./config.js";
import { apiBodyLimit } from "./bodyLimits.js";
import type { AppEnv } from "./types.js";

// Capture the real caps so each test can shrink them to fast, deterministic
// values and restore afterward.
const original = {
  MAX_FILE_UPLOAD_BYTES: config.MAX_FILE_UPLOAD_BYTES,
  MAX_JSON_BODY_BYTES: config.MAX_JSON_BODY_BYTES,
  MAX_UPLOAD_BYTES: config.MAX_UPLOAD_BYTES,
};

afterEach(() => {
  config.MAX_FILE_UPLOAD_BYTES = original.MAX_FILE_UPLOAD_BYTES;
  config.MAX_JSON_BODY_BYTES = original.MAX_JSON_BODY_BYTES;
  config.MAX_UPLOAD_BYTES = original.MAX_UPLOAD_BYTES;
});

/**
 * Build an app whose `/api/*` body-limit dispatch mirrors production. The
 * handler returns 200 only if the body-limit guard let the request through to
 * it (i.e. it was NOT rejected with 413). The handler reads the body so a real
 * over-cap body would have already been refused upstream.
 */
function buildApp() {
  const app = new Hono<AppEnv>();
  app.use("/api/*", apiBodyLimit());
  app.post("/api/files/:repoId/upload", async (c) => {
    await c.req.arrayBuffer();
    return c.json({ reached: true });
  });
  app.post("/api/teams", async (c) => {
    await c.req.arrayBuffer();
    return c.json({ reached: true });
  });
  return app;
}

function multipartBody(bytes: number): { body: Blob; type: string } {
  const boundary = "----dsTestBoundary";
  const head =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="a.bin"\r\n` +
    `Content-Type: application/octet-stream\r\n\r\n`;
  const tail = `\r\n--${boundary}--\r\n`;
  const payload = "x".repeat(bytes);
  return {
    body: new Blob([head, payload, tail]),
    type: `multipart/form-data; boundary=${boundary}`,
  };
}

describe("apiBodyLimit (FIX 1: file-upload body cap)", () => {
  test("a ~2MB upload is NOT rejected by bodyLimit (reaches the handler)", async () => {
    // Production defaults: file upload 12MB, general API 1MB. A 2MB upload must
    // pass the upload cap rather than hitting the 1MB general default.
    const app = buildApp();
    const { body, type } = multipartBody(2 * 1024 * 1024);
    const res = await app.request("/api/files/repo123/upload", {
      method: "POST",
      headers: { "Content-Type": type },
      body,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reached: true });
  });

  test("an over-cap (>12MB) upload returns 413", async () => {
    // Shrink the cap so the test stays small/fast: 1MB upload cap, body ~2MB.
    config.MAX_FILE_UPLOAD_BYTES = 1024 * 1024;
    const app = buildApp();
    const { body, type } = multipartBody(2 * 1024 * 1024);
    const res = await app.request("/api/files/repo123/upload", {
      method: "POST",
      headers: { "Content-Type": type },
      body,
    });
    expect(res.status).toBe(413);
  });

  test("the upload cap does not shadow the tighter general cap for other routes", async () => {
    // A non-upload /api route still uses the small general JSON cap: a 2MB body
    // to /api/teams is rejected even though the upload cap is large.
    config.MAX_JSON_BODY_BYTES = 1024 * 1024;
    const app = buildApp();
    const { body, type } = multipartBody(2 * 1024 * 1024);
    const res = await app.request("/api/teams", {
      method: "POST",
      headers: { "Content-Type": type },
      body,
    });
    expect(res.status).toBe(413);
  });
});
