import { afterEach, describe, expect, test } from "bun:test";
import { $ } from "bun";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { inArray } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { config } from "../lib/config.js";
import { createBareRepo, repairRepoHooks } from "./repoManager.js";

const dirs: string[] = [];
const repoIds: string[] = [];

afterEach(async () => {
  if (repoIds.length) {
    await db
      .delete(schema.repos)
      .where(inArray(schema.repos.id, repoIds))
      .run();
    repoIds.length = 0;
  }
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  dirs.length = 0;
});

async function scratch(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

async function seedRepoRow(diskPath: string): Promise<void> {
  const id = `repo_hooktest_${Math.random().toString(36).slice(2)}`;
  await db.insert(schema.repos).values({
    id,
    ownerType: "user",
    diskPath,
  });
  repoIds.push(id);
}

describe("repairRepoHooks (FIX 2: rewrite existing repos' post-receive hook)", () => {
  test("rewrites an old baked-secret hook to the env-based hook (mode 0700)", async () => {
    const root = await scratch("ds-hookrepair-");
    const repoPath = join(root, "repo.git");
    await $`git init --bare ${repoPath}`.quiet();

    // Simulate the OLD vulnerable hook: plaintext secret baked into the file
    // and world-readable permissions.
    const hookPath = join(repoPath, "hooks", "post-receive");
    const oldSecret = "super-secret-plaintext-value-123";
    await writeFile(
      hookPath,
      `#!/bin/bash\ncurl -H "X-Hook-Secret: ${oldSecret}" http://localhost/internal/hooks/post-receive\n`,
      "utf-8"
    );
    await chmod(hookPath, 0o644);

    await seedRepoRow(repoPath);

    const result = await repairRepoHooks();
    expect(result.repaired).toBeGreaterThanOrEqual(1);

    const rewritten = await readFile(hookPath, "utf-8");
    // The baked plaintext secret is gone; the hook now reads $HOOK_SECRET.
    expect(rewritten).not.toContain(oldSecret);
    expect(rewritten).toContain("${HOOK_SECRET}");

    // And the file is locked down to owner-only (0700).
    const info = await stat(hookPath);
    expect(info.mode & 0o777).toBe(0o700);
  });

  test("post-receive hook JSON-escapes a malicious ref name (no injection)", async () => {
    const root = await scratch("ds-hook-refescape-");
    const repoPath = join(root, "repo.git");

    // Stand up a listener that captures the hook's request body.
    let receivedBody = "";
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        receivedBody = await req.text();
        return new Response("ok");
      },
    });
    const savedBaseUrl = config.HOOK_BASE_URL;
    config.HOOK_BASE_URL = `http://localhost:${server.port}`;

    try {
      await createBareRepo(repoPath);
      const hookPath = join(repoPath, "hooks", "post-receive");

      // A ref a client could push that would break naive string interpolation:
      // a double-quote followed by JSON-control characters.
      const maliciousRef = 'refs/heads/"; DROP {bad: json} //';
      const stdin = `0000000 1111111 ${maliciousRef}\n`;

      const proc = Bun.spawn(["bash", hookPath], {
        env: { ...process.env, HOOK_SECRET: "x" },
        stdin: Buffer.from(stdin),
        stdout: "ignore",
        stderr: "ignore",
      });
      await proc.exited;

      expect(receivedBody).not.toBe("");
      // The body must be valid JSON despite the hostile ref...
      const parsed = JSON.parse(receivedBody) as { ref: string };
      // ...and the ref must round-trip exactly (no truncation / extra fields).
      expect(parsed.ref).toBe(maliciousRef);
    } finally {
      config.HOOK_BASE_URL = savedBaseUrl;
      server.stop(true);
    }
  });

  test("is idempotent and tolerant of a missing repo directory", async () => {
    const root = await scratch("ds-hookrepair-idem-");
    const repoPath = join(root, "repo.git");
    await $`git init --bare ${repoPath}`.quiet();
    await seedRepoRow(repoPath);

    // A row whose diskPath does not exist on disk must be skipped, not fatal.
    const missingPath = join(root, "does-not-exist.git");
    await seedRepoRow(missingPath);

    const first = await repairRepoHooks();
    expect(first.repaired).toBeGreaterThanOrEqual(1);
    expect(first.skipped).toBeGreaterThanOrEqual(1);

    const hookPath = join(repoPath, "hooks", "post-receive");
    const afterFirst = await readFile(hookPath, "utf-8");

    // Running again produces identical content (idempotent).
    const second = await repairRepoHooks();
    expect(second.repaired).toBeGreaterThanOrEqual(1);
    const afterSecond = await readFile(hookPath, "utf-8");
    expect(afterSecond).toBe(afterFirst);
  });
});
