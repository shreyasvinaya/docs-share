import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// The login flow verifies the token against /api/auth/session and persists it to
// ~/.docs-share/config.json. We stand up a tiny mock server, run the real CLI in
// a child process with HOME redirected to a throwaway dir, and inspect the saved
// config + the process output. This exercises stdin reading, env precedence, and
// the "never print the token" guarantee end-to-end.

const ENTRY = join(import.meta.dir, "..", "index.ts");

let home: string;
let server: ReturnType<typeof Bun.serve>;
let receivedTokens: string[];

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ds-cli-login-"));
  receivedTokens = [];
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const auth = req.headers.get("authorization") ?? "";
      receivedTokens.push(auth);
      const url = new URL(req.url);
      if (url.pathname === "/api/auth/session") {
        return Response.json({
          user: { email: "user@example.com", displayName: "Test User" },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
});

afterEach(() => {
  server.stop(true);
  if (home) rmSync(home, { recursive: true, force: true });
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
  opts: { stdin?: string; env?: Record<string, string> } = {}
): Promise<RunResult> {
  const proc = Bun.spawn(["bun", ENTRY, ...args], {
    env: {
      ...process.env,
      HOME: home,
      PATRA_TOKEN: "",
      DOCS_SHARE_TOKEN: "",
      PATRA_API_URL: apiUrl(),
      ...(opts.env ?? {}),
    },
    stdin: opts.stdin !== undefined ? new TextEncoder().encode(opts.stdin) : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { code, stdout, stderr };
}

function readSavedConfig(): { auth?: { token: string; email: string } } {
  return JSON.parse(
    readFileSync(join(home, ".docs-share", "config.json"), "utf-8")
  );
}

describe("login --token-stdin", () => {
  test("reads the token from stdin and saves it", async () => {
    const res = await runCli(["login", "--token-stdin"], {
      stdin: "tok_from_stdin\n",
    });
    expect(res.code).toBe(0);
    expect(receivedTokens).toContain("Bearer tok_from_stdin");
    expect(readSavedConfig().auth?.token).toBe("tok_from_stdin");
    // The token must never be printed to stdout.
    expect(res.stdout).not.toContain("tok_from_stdin");
    expect(res.stderr).not.toContain("tok_from_stdin");
  });

  test("errors when stdin is empty", async () => {
    const res = await runCli(["login", "--token-stdin"], { stdin: "   \n" });
    expect(res.code).not.toBe(0);
    expect(res.stderr).toMatch(/no token was read from stdin/);
  });

  test("trims surrounding whitespace/newlines and exits cleanly (no hang)", async () => {
    // Surrounding whitespace and a trailing newline must be trimmed, the read
    // must settle, and the process must not hang on leftover/resumed stdin.
    const res = await runCli(["login", "--token-stdin"], {
      stdin: "  tok_padded  \n",
    });
    expect(res.code).toBe(0);
    expect(receivedTokens).toContain("Bearer tok_padded");
    expect(readSavedConfig().auth?.token).toBe("tok_padded");
  });
});

describe("login env precedence", () => {
  test("uses PATRA_TOKEN when no flag/stdin is given", async () => {
    const res = await runCli(["login"], { env: { PATRA_TOKEN: "env_patra_tok" } });
    expect(res.code).toBe(0);
    expect(receivedTokens).toContain("Bearer env_patra_tok");
    expect(readSavedConfig().auth?.token).toBe("env_patra_tok");
  });

  test("explicit --token-stdin beats the env var", async () => {
    const res = await runCli(["login", "--token-stdin"], {
      stdin: "flag_tok",
      env: { PATRA_TOKEN: "env_tok" },
    });
    expect(res.code).toBe(0);
    expect(receivedTokens).toContain("Bearer flag_tok");
    expect(readSavedConfig().auth?.token).toBe("flag_tok");
  });

  test("DOCS_SHARE_TOKEN is honored as a fallback", async () => {
    const res = await runCli(["login"], {
      env: { DOCS_SHARE_TOKEN: "legacy_env_tok" },
    });
    expect(res.code).toBe(0);
    expect(receivedTokens).toContain("Bearer legacy_env_tok");
  });

  test("errors when no token is provided anywhere", async () => {
    const res = await runCli(["login"]);
    expect(res.code).not.toBe(0);
    expect(res.stderr).toMatch(/Token is required/);
  });
});

describe("login --token visibility warning", () => {
  test("warns on stderr that --token is visible but still works", async () => {
    const res = await runCli(["login", "--token", "visible_tok"]);
    expect(res.code).toBe(0);
    expect(res.stderr).toMatch(/visible in your process list/);
    expect(receivedTokens).toContain("Bearer visible_tok");
    // Even with --token, the secret is not echoed to stdout.
    expect(res.stdout).not.toContain("visible_tok");
  });

  test("rejects --token and --token-stdin together", async () => {
    const res = await runCli(["login", "--token", "x", "--token-stdin"], {
      stdin: "y",
    });
    expect(res.code).not.toBe(0);
    expect(res.stderr).toMatch(/not both/);
  });
});

describe("login does not leak the token", () => {
  test("whoami output never contains the token", async () => {
    // First log in.
    await runCli(["login", "--token-stdin"], { stdin: "tok_xyz" });
    const res = await runCli(["whoami"], {
      env: { PATRA_TOKEN: "tok_xyz" },
    });
    expect(res.code).toBe(0);
    expect(res.stdout).not.toContain("tok_xyz");
    expect(res.stdout).toContain("user@example.com");
  });
});
