import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { AppEnv } from "../lib/types.js";
import { openApiSpec } from "./openapi.js";
import { buildLlmsTxt } from "./llms.js";

// Mirror the public doc routes from index.ts without booting the full app
// (which would require DB and git setup at import time).
function docsApp() {
  const app = new Hono<AppEnv>();
  app.get("/openapi.json", (c) => c.json(openApiSpec));
  app.get("/llms.txt", (c) =>
    c.text(
      buildLlmsTxt({ appUrl: "https://docs.example.com", apiUrl: "https://api.example.com" }),
      200,
      { "Content-Type": "text/plain; charset=utf-8" }
    )
  );
  return app;
}

describe("GET /openapi.json", () => {
  test("returns a valid OpenAPI 3.1 JSON document", async () => {
    const res = await docsApp().request("/openapi.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const spec = (await res.json()) as typeof openApiSpec;
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info.title).toBe("docs-share API");
  });

  test("documents every endpoint family", async () => {
    const res = await docsApp().request("/openapi.json");
    const spec = (await res.json()) as typeof openApiSpec;
    const paths = Object.keys(spec.paths);

    for (const expected of [
      "/health",
      "/openapi.json",
      "/llms.txt",
      "/api/auth/google",
      "/api/auth/session",
      "/api/auth/tokens",
      "/api/users/me",
      "/api/teams",
      "/api/teams/{teamId}/members",
      "/api/projects",
      "/api/repos/{repoId}/github-sync",
      "/api/files/{repoId}",
      "/api/files/{repoId}/upload",
      "/api/drafts",
      "/api/shares",
      "/api/shares/public/{token}",
      "/view/public/{token}",
      "/d/{draftId}",
      "/git/{ownerType}/{ownerId}/info/refs",
      "/internal/repo",
    ]) {
      expect(paths).toContain(expected);
    }
  });

  test("declares the bearer, session, and basic security schemes", async () => {
    const res = await docsApp().request("/openapi.json");
    const spec = (await res.json()) as typeof openApiSpec;
    const schemes = spec.components.securitySchemes as Record<string, unknown>;
    expect(schemes.bearerAuth).toBeDefined();
    expect(schemes.sessionCookie).toBeDefined();
    expect(schemes.basicAuth).toBeDefined();
  });

  test("every operation references a defined component when it uses $ref", async () => {
    const res = await docsApp().request("/openapi.json");
    const spec = (await res.json()) as typeof openApiSpec;
    const defined = new Set([
      ...Object.keys(spec.components.schemas as Record<string, unknown>).map(
        (name) => `#/components/schemas/${name}`
      ),
      ...Object.keys(spec.components.parameters as Record<string, unknown>).map(
        (name) => `#/components/parameters/${name}`
      ),
    ]);

    const refs: string[] = [];
    const walk = (node: unknown) => {
      if (Array.isArray(node)) {
        node.forEach(walk);
      } else if (node && typeof node === "object") {
        for (const [key, value] of Object.entries(node)) {
          if (key === "$ref" && typeof value === "string") refs.push(value);
          else walk(value);
        }
      }
    };
    walk(spec.paths);

    for (const ref of refs) {
      expect(defined.has(ref)).toBe(true);
    }
  });
});

describe("GET /llms.txt", () => {
  test("returns plain text with the project summary", async () => {
    const res = await docsApp().request("/llms.txt");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");

    const body = await res.text();
    expect(body.startsWith("# docs-share")).toBe(true);
    expect(body).toContain("## API base and auth");
    expect(body).toContain("## CLI commands");
  });

  test("interpolates the configured URLs", () => {
    const body = buildLlmsTxt({
      appUrl: "https://app.test/",
      apiUrl: "https://api.test/",
    });
    // Trailing slashes are trimmed.
    expect(body).toContain("Base URL: https://api.test\n");
    expect(body).toContain("https://api.test/openapi.json");
    expect(body).toContain("https://app.test/docs/api-reference");
    expect(body).not.toContain("https://api.test//");
  });
});
