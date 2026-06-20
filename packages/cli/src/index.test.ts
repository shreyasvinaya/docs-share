import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// H1: the top-level fatal handler must map a CliError to its own exit code,
// preserve an already-set non-zero process.exitCode, and never crash with a raw
// Node stack trace (absent --verbose). We exercise the real entry point in a
// child process and inspect the exit code and output.

const ENTRY = join(import.meta.dir, "index.ts");

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ds-cli-index-"));
});

afterEach(() => {
  if (home) rmSync(home, { recursive: true, force: true });
});

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runCli(
  args: string[],
  env: Record<string, string> = {}
): Promise<RunResult> {
  const proc = Bun.spawn(["bun", ENTRY, ...args], {
    env: {
      ...process.env,
      HOME: home,
      PATRA_TOKEN: "tok",
      DOCS_SHARE_TOKEN: "",
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

describe("global fatal handling (H1)", () => {
  test("a FileNotFoundError exits with its specific code (5)", async () => {
    const res = await runCli(
      ["push", "/no/such/path/zzz", "--to", "personal"],
      { PATRA_API_URL: "http://localhost:1" }
    );
    expect(res.code).toBe(5);
    expect(res.stderr).toMatch(/File not found/);
    // No raw Node stack trace without --verbose.
    expect(res.stderr).not.toMatch(/at Object\.<anonymous>/);
  });

  test("a ValidationError (bad API URL scheme) exits with code 6", async () => {
    const res = await runCli(["whoami"], { PATRA_API_URL: "ftp://nope" });
    expect(res.code).toBe(6);
    expect(res.stderr).toMatch(/must use http/);
  });

  test("a NetworkError (unreachable host) exits with code 2", async () => {
    const res = await runCli(["whoami"], {
      // Reserved TEST-NET address that should not be routable.
      PATRA_API_URL: "http://127.0.0.1:1",
      PATRA_MAX_RETRIES: "1",
    });
    expect(res.code).toBe(2);
  });

  test("prints the error message but exits cleanly (single line, no double-print)", async () => {
    const res = await runCli(["whoami"], { PATRA_API_URL: "ftp://nope" });
    // The error should appear exactly once on stderr (re-entrancy guard prevents
    // a second print).
    const occurrences = res.stderr.split("must use http").length - 1;
    expect(occurrences).toBe(1);
  });
});
