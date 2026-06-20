import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// config.ts derives its config dir from homedir() ($HOME) at module load, so we
// run saveConfig in a child process with HOME pointed at a throwaway dir. That
// proves the real on-disk permissions without touching the developer's home.
let tempHome: string;

afterEach(() => {
  if (tempHome) rmSync(tempHome, { recursive: true, force: true });
});

describe("CLI config token storage permissions", () => {
  test("writes the config dir 0700 and the token file 0600", async () => {
    tempHome = mkdtempSync(join(tmpdir(), "ds-cli-config-"));
    const script = `
      import { saveConfig } from ${JSON.stringify(
        join(import.meta.dir, "config.ts")
      )};
      saveConfig({
        apiUrl: "http://localhost:3000",
        auth: { token: "ds_secret_token", email: "user@example.com" },
      });
    `;

    const proc = Bun.spawn(["bun", "-e", script], {
      env: { ...process.env, HOME: tempHome },
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    expect(code).toBe(0);

    const dirMode = statSync(join(tempHome, ".docs-share")).mode & 0o777;
    const fileMode =
      statSync(join(tempHome, ".docs-share", "config.json")).mode & 0o777;

    expect(dirMode).toBe(0o700);
    expect(fileMode).toBe(0o600);
  });
});

/**
 * loadConfig derives its path from homedir() at module load, so we exercise the
 * missing-vs-corrupt distinction in child processes with HOME pointed at a
 * throwaway dir. The child exits 0 on the expected outcome, non-zero otherwise.
 */
describe("loadConfig error handling", () => {
  let home: string;

  afterEach(() => {
    if (home) rmSync(home, { recursive: true, force: true });
  });

  async function runChild(script: string): Promise<{ code: number; stderr: string }> {
    const proc = Bun.spawn(["bun", "-e", script], {
      env: { ...process.env, HOME: home, PATRA_TOKEN: "", DOCS_SHARE_TOKEN: "" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    const stderr = await new Response(proc.stderr).text();
    return { code, stderr };
  }

  const configPath = JSON.stringify(join(import.meta.dir, "config.ts"));

  test("returns the default config when the file is missing", async () => {
    home = mkdtempSync(join(tmpdir(), "ds-cli-missing-"));
    const { code } = await runChild(`
      import { loadConfig } from ${configPath};
      const c = loadConfig();
      if (c.apiUrl !== "http://localhost:3000") process.exit(2);
      if (c.auth !== undefined) process.exit(3);
      process.exit(0);
    `);
    expect(code).toBe(0);
  });

  test("throws a clear error when the file is corrupt JSON", async () => {
    home = mkdtempSync(join(tmpdir(), "ds-cli-corrupt-"));
    mkdirSync(join(home, ".docs-share"), { recursive: true });
    writeFileSync(join(home, ".docs-share", "config.json"), "{ this is not json");

    const { code, stderr } = await runChild(`
      import { loadConfig } from ${configPath};
      try {
        loadConfig();
        process.exit(2); // should have thrown
      } catch (err) {
        process.stderr.write(String(err && err.message));
        process.exit(0);
      }
    `);
    expect(code).toBe(0);
    expect(stderr).toMatch(/corrupt or unreadable/);
    expect(stderr).toMatch(/config\.json/);
  });

  test("throws when the loaded shape is invalid (apiUrl wrong type)", async () => {
    home = mkdtempSync(join(tmpdir(), "ds-cli-shape-"));
    mkdirSync(join(home, ".docs-share"), { recursive: true });
    writeFileSync(
      join(home, ".docs-share", "config.json"),
      JSON.stringify({ apiUrl: 123 })
    );

    const { code, stderr } = await runChild(`
      import { loadConfig } from ${configPath};
      try {
        loadConfig();
        process.exit(2);
      } catch (err) {
        process.stderr.write(String(err && err.message));
        process.exit(0);
      }
    `);
    expect(code).toBe(0);
    expect(stderr).toMatch(/corrupt or unreadable/);
  });

  test("REFUSES a world-writable config file (M1)", async () => {
    home = mkdtempSync(join(tmpdir(), "ds-cli-perm-world-"));
    mkdirSync(join(home, ".docs-share"), { recursive: true });
    const file = join(home, ".docs-share", "config.json");
    writeFileSync(
      file,
      JSON.stringify({
        apiUrl: "https://evil.example.com",
        auth: { token: "t", email: "a@b.c" },
      })
    );
    // Relax perms: owner rw + world write (0606).
    chmodSync(file, 0o606);

    const { code, stderr } = await runChild(`
      import { loadConfig } from ${configPath};
      try {
        loadConfig();
        process.exit(2); // should have refused
      } catch (err) {
        process.stderr.write(String(err && err.message));
        process.exit(0);
      }
    `);
    expect(code).toBe(0);
    expect(stderr).toMatch(/writable by group or others/);
    expect(stderr).toMatch(/refusing to trust/i);
  });

  test("REFUSES a group-writable config file (M1)", async () => {
    home = mkdtempSync(join(tmpdir(), "ds-cli-perm-group-"));
    mkdirSync(join(home, ".docs-share"), { recursive: true });
    const file = join(home, ".docs-share", "config.json");
    writeFileSync(
      file,
      JSON.stringify({ apiUrl: "https://x.example.com" })
    );
    // owner rw + group write (0660).
    chmodSync(file, 0o660);

    const { code, stderr } = await runChild(`
      import { loadConfig } from ${configPath};
      try {
        loadConfig();
        process.exit(2);
      } catch (err) {
        process.stderr.write(String(err && err.message));
        process.exit(0);
      }
    `);
    expect(code).toBe(0);
    expect(stderr).toMatch(/writable by group or others/);
  });

  test("ACCEPTS a 0600 config file (M1)", async () => {
    home = mkdtempSync(join(tmpdir(), "ds-cli-perm-ok-"));
    mkdirSync(join(home, ".docs-share"), { recursive: true });
    const file = join(home, ".docs-share", "config.json");
    writeFileSync(
      file,
      JSON.stringify({ apiUrl: "https://ok.example.com" })
    );
    chmodSync(file, 0o600);

    const { code } = await runChild(`
      import { loadConfig } from ${configPath};
      const c = loadConfig();
      if (c.apiUrl !== "https://ok.example.com") process.exit(2);
      process.exit(0);
    `);
    expect(code).toBe(0);
  });
});

describe("redactUrl (L2)", () => {
  test("strips user:pass userinfo from a full URL", async () => {
    const { redactUrl } = await import("./config.js");
    const out = redactUrl("http://user:hunter2@host.example.com/path");
    expect(out).not.toContain("hunter2");
    expect(out).not.toContain("user:");
    expect(out).toContain("host.example.com");
  });

  test("leaves a URL without userinfo unchanged in substance", async () => {
    const { redactUrl } = await import("./config.js");
    expect(redactUrl("https://host.example.com/x")).toContain(
      "host.example.com"
    );
  });

  test("best-effort strips creds from a non-parsable URL-ish value", async () => {
    const { redactUrl } = await import("./config.js");
    const out = redactUrl("http://bob:secretpw@");
    expect(out).not.toContain("secretpw");
  });

  test("validateApiUrl error redacts embedded credentials", async () => {
    const { validateApiUrl } = await import("./config.js");
    let message = "";
    try {
      // ftp:// is rejected; the error echoes the URL — creds must be scrubbed.
      validateApiUrl("ftp://alice:topsecret@host.example.com");
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toMatch(/must use http/);
    expect(message).not.toContain("topsecret");
    expect(message).not.toContain("alice");
  });
});

describe("getToken / getApiUrl env precedence", () => {
  const saved: Record<string, string | undefined> = {};
  const keys = [
    "PATRA_TOKEN",
    "DOCS_SHARE_TOKEN",
    "PATRA_API_URL",
    "DOCS_SHARE_API_URL",
  ];

  beforeEach(() => {
    for (const k of keys) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test("getToken prefers PATRA_TOKEN over DOCS_SHARE_TOKEN", async () => {
    const { getToken } = await import("./config.js");
    process.env.PATRA_TOKEN = "patra_tok";
    process.env.DOCS_SHARE_TOKEN = "legacy_tok";
    expect(getToken()).toBe("patra_tok");
  });

  test("getToken falls back to DOCS_SHARE_TOKEN", async () => {
    const { getToken } = await import("./config.js");
    process.env.DOCS_SHARE_TOKEN = "legacy_tok";
    expect(getToken()).toBe("legacy_tok");
  });

  test("getApiUrl prefers PATRA_API_URL over DOCS_SHARE_API_URL", async () => {
    const { getApiUrl } = await import("./config.js");
    process.env.PATRA_API_URL = "https://patra.example.com";
    process.env.DOCS_SHARE_API_URL = "https://legacy.example.com";
    expect(getApiUrl()).toBe("https://patra.example.com");
  });

  test("getApiUrl falls back to DOCS_SHARE_API_URL", async () => {
    const { getApiUrl } = await import("./config.js");
    process.env.DOCS_SHARE_API_URL = "https://legacy.example.com";
    expect(getApiUrl()).toBe("https://legacy.example.com");
  });

  test("getApiUrl validates env URLs and rejects garbage", async () => {
    const { getApiUrl } = await import("./config.js");
    process.env.PATRA_API_URL = "ftp://nope.example.com";
    expect(() => getApiUrl()).toThrow(/must use http/);
  });

  test("getApiUrl override takes precedence and is validated", async () => {
    const { getApiUrl } = await import("./config.js");
    process.env.PATRA_API_URL = "https://env.example.com";
    expect(getApiUrl("https://override.example.com")).toBe(
      "https://override.example.com"
    );
    expect(() => getApiUrl("garbage")).toThrow(/not a valid URL/);
  });
});

describe("validateApiUrl", () => {
  test("accepts http and https", async () => {
    const { validateApiUrl } = await import("./config.js");
    expect(validateApiUrl("http://localhost:3000")).toBe("http://localhost:3000");
    expect(validateApiUrl("https://a.example.com")).toBe("https://a.example.com");
  });

  test("rejects non-http(s) schemes and garbage", async () => {
    const { validateApiUrl } = await import("./config.js");
    expect(() => validateApiUrl("file:///etc/passwd")).toThrow(/must use http/);
    expect(() => validateApiUrl("::::")).toThrow(/not a valid URL/);
  });
});
