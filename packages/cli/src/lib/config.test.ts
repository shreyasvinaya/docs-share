import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
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
