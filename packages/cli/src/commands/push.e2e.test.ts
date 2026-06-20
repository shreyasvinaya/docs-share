import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// End-to-end push tests: drive the real CLI against a mock server to cover the
// preview-URL encoding (M2), the in-loop size-cap re-check (M4), and the
// share-failure exit code (L5).

const ENTRY = join(import.meta.dir, "..", "index.ts");
const REPO_ID = "repo_123";

let home: string;
let workdir: string;
let server: ReturnType<typeof Bun.serve>;
let failShares = false;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ds-cli-pushe2e-home-"));
  workdir = mkdtempSync(join(tmpdir(), "ds-cli-pushe2e-work-"));
  failShares = false;
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === "/api/users/me") {
        return Response.json({
          data: {
            id: "u1",
            email: "user@example.com",
            displayName: "User",
            repo: { id: REPO_ID },
          },
        });
      }

      if (url.pathname === "/api/teams") {
        return Response.json({ data: [] });
      }

      if (url.pathname === `/api/files/${REPO_ID}/upload`) {
        return Response.json({
          data: { commitSha: "abcdef1234567890", filesUploaded: 1, message: "ok" },
        });
      }

      if (url.pathname === "/api/shares") {
        if (failShares) {
          return Response.json({ error: "share rejected" }, { status: 403 });
        }
        return Response.json({ data: { id: "share_1" } });
      }

      return new Response("not found", { status: 404 });
    },
  });
});

afterEach(() => {
  server.stop(true);
  if (home) rmSync(home, { recursive: true, force: true });
  if (workdir) rmSync(workdir, { recursive: true, force: true });
});

function apiUrl(): string {
  return `http://localhost:${server.port}`;
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runCli(
  args: string[],
  env: Record<string, string> = {}
): Promise<RunResult> {
  const proc = Bun.spawn(["bun", ENTRY, "--format", "json", "push", ...args], {
    env: {
      ...process.env,
      HOME: home,
      PATRA_TOKEN: "tok",
      DOCS_SHARE_TOKEN: "",
      PATRA_API_URL: apiUrl(),
      ...env,
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { code, stdout, stderr };
}

describe("push preview-URL encoding (M2)", () => {
  test("percent-encodes path segments with spaces and special chars", async () => {
    const file = join(workdir, "my report #1.md");
    writeFileSync(file, "hello");

    const res = await runCli([file, "--to", "personal/q3 reports"]);
    expect(res.code).toBe(0);

    const out = JSON.parse(res.stdout) as {
      previewUrls: Array<{ file: string; url: string }>;
    };
    const url = out.previewUrls[0].url;
    // Space -> %20, '#' -> %23. The raw chars must NOT appear in the URL.
    expect(url).toContain("q3%20reports");
    expect(url).toContain("my%20report%20%231.md");
    expect(url).not.toContain("my report #1");
    expect(url).not.toContain(" ");
    expect(url).not.toContain("#");
  });
});

describe("push share-failure exit code (L5)", () => {
  test("exits non-zero when an email share fails (upload still succeeded)", async () => {
    failShares = true;
    const file = join(workdir, "doc.md");
    writeFileSync(file, "content");

    const res = await runCli([file, "--to", "personal", "--share", "a@b.c"]);
    // Upload succeeded but the share failed -> non-zero exit so scripts detect it.
    // process.exitCode was set to NETWORK_ERROR (2) and the normal exit honors it
    // (the H1 handlers do not clobber an already-set non-zero exit code).
    expect(res.code).toBe(2);
    expect(res.stderr).toMatch(/Failed to share/);
  });

  test("exits 0 when shares succeed", async () => {
    const file = join(workdir, "doc.md");
    writeFileSync(file, "content");

    const res = await runCli([file, "--to", "personal", "--share", "a@b.c"]);
    expect(res.code).toBe(0);
  });

  test("exits 0 with no share requested", async () => {
    const file = join(workdir, "doc.md");
    writeFileSync(file, "content");

    const res = await runCli([file, "--to", "personal"]);
    expect(res.code).toBe(0);
  });
});

describe("push byte-cap enforcement (M4, end-to-end)", () => {
  test("refuses an upload that exceeds the byte cap", async () => {
    // Two files of 50 bytes each = 100 bytes; cap at 60.
    mkdirSync(join(workdir, "d"));
    writeFileSync(join(workdir, "d", "a.md"), "x".repeat(50));
    writeFileSync(join(workdir, "d", "b.md"), "y".repeat(50));

    const res = await runCli([join(workdir, "d"), "--to", "personal"], {
      PATRA_MAX_UPLOAD_BYTES: "60",
    });
    expect(res.code).not.toBe(0);
    expect(res.stderr).toMatch(/limit/i);
  });
});
