import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  assertProductionSecret,
  isPrivateOrLoopbackHost,
  isProduction,
  normalizeRelativePath,
  redactInternalPaths,
  resolveAndValidateHost,
  resolveInside,
  resolveRealPathInside,
  safeNextPath,
  validateWebhookUrl,
} from "./security.js";

describe("isProduction", () => {
  test("only treats NODE_ENV=production as production", () => {
    expect(isProduction({ NODE_ENV: "production" })).toBe(true);
    expect(isProduction({ NODE_ENV: "development" })).toBe(false);
    expect(isProduction({})).toBe(false);
  });
});

describe("assertProductionSecret", () => {
  test("rejects default and short secrets in production", () => {
    expect(() =>
      assertProductionSecret("SESSION_SECRET", "dev-secret-change-in-production", {
        NODE_ENV: "production",
      })
    ).toThrow("SESSION_SECRET must be set");

    expect(() =>
      assertProductionSecret("HOOK_SECRET", "short", { NODE_ENV: "production" })
    ).toThrow("HOOK_SECRET must be set");
  });

  test("rejects the draft and github token dev defaults in production", () => {
    expect(() =>
      assertProductionSecret(
        "DRAFT_CONTENT_SECRET",
        "dev-draft-content-secret-change-in-production",
        { NODE_ENV: "production" }
      )
    ).toThrow("DRAFT_CONTENT_SECRET must be set");

    expect(() =>
      assertProductionSecret(
        "GITHUB_TOKEN_SECRET",
        "dev-github-token-secret-change-in-production",
        { NODE_ENV: "production" }
      )
    ).toThrow("GITHUB_TOKEN_SECRET must be set");
  });

  test("allows strong production secrets and dev defaults outside production", () => {
    expect(() =>
      assertProductionSecret("SESSION_SECRET", "x".repeat(32), {
        NODE_ENV: "production",
      })
    ).not.toThrow();

    expect(() =>
      assertProductionSecret("GITHUB_TOKEN_SECRET", "a".repeat(40), {
        NODE_ENV: "production",
      })
    ).not.toThrow();

    expect(() =>
      assertProductionSecret("SESSION_SECRET", "dev-secret-change-in-production", {
        NODE_ENV: "development",
      })
    ).not.toThrow();
  });
});

describe("normalizeRelativePath", () => {
  test("normalizes safe relative paths", () => {
    expect(normalizeRelativePath("docs/report.html")).toBe("docs/report.html");
    expect(normalizeRelativePath("docs//report.html")).toBe("docs/report.html");
    expect(normalizeRelativePath("")).toBe("");
    expect(normalizeRelativePath(null)).toBe("");
  });

  test("rejects absolute, traversal, current-directory, and nul paths", () => {
    expect(normalizeRelativePath("/etc/passwd")).toBeNull();
    expect(normalizeRelativePath("../secrets")).toBeNull();
    expect(normalizeRelativePath("docs/../secrets")).toBeNull();
    expect(normalizeRelativePath("docs/./report.html")).toBeNull();
    expect(normalizeRelativePath("docs\0/report.html")).toBeNull();
  });

  test("rejects .git segments anywhere (case-insensitive)", () => {
    expect(normalizeRelativePath(".git")).toBeNull();
    expect(normalizeRelativePath(".git/config")).toBeNull();
    expect(normalizeRelativePath("docs/.git/hooks/pre-commit")).toBeNull();
    expect(normalizeRelativePath("docs/.GIT/config")).toBeNull();
    expect(normalizeRelativePath("a/.Git/b")).toBeNull();
    // A file merely named like ".gitignore" is still a normal file.
    expect(normalizeRelativePath("docs/.gitignore")).toBe("docs/.gitignore");
  });

  test("rejects control characters and DEL", () => {
    expect(
      normalizeRelativePath("docs/" + String.fromCharCode(1) + "report.html")
    ).toBeNull();
    expect(
      normalizeRelativePath("docs/" + String.fromCharCode(10) + "report.html")
    ).toBeNull();
    expect(
      normalizeRelativePath("docs/" + String.fromCharCode(31) + "x")
    ).toBeNull();
    expect(
      normalizeRelativePath("docs/" + String.fromCharCode(127) + "x")
    ).toBeNull();
  });

  test("still accepts normal nested paths and dotfiles", () => {
    expect(normalizeRelativePath("a/b/c/report.html")).toBe(
      "a/b/c/report.html"
    );
    expect(normalizeRelativePath(".env.example")).toBe(".env.example");
  });

  test("rejects git pathspec magic (segments starting with ':')", () => {
    // These would otherwise widen a `git ls-files`/`git rm`/`git log` scope to
    // the whole repo when GIT_LITERAL_PATHSPECS isn't set.
    expect(normalizeRelativePath(":(glob)**")).toBeNull();
    expect(normalizeRelativePath(":(top)")).toBeNull();
    expect(normalizeRelativePath(":(exclude)docs")).toBeNull();
    expect(normalizeRelativePath(":!docs")).toBeNull();
    expect(normalizeRelativePath(":/")).toBeNull();
    expect(normalizeRelativePath(":/etc/passwd")).toBeNull();
    // A colon nested in a deeper segment is just as dangerous.
    expect(normalizeRelativePath("docs/:(glob)**")).toBeNull();
    // A bare colon as the leading char of a segment.
    expect(normalizeRelativePath(":colon")).toBeNull();
    // A colon NOT at the start of a segment is a normal (if unusual) filename.
    expect(normalizeRelativePath("docs/a:b.txt")).toBe("docs/a:b.txt");
  });
});

describe("resolveInside", () => {
  test("resolves safe paths under the base directory", () => {
    expect(resolveInside("/tmp/docs-share", "docs/report.html")).toBe(
      "/tmp/docs-share/docs/report.html"
    );
  });

  test("rejects paths that would escape the base directory", () => {
    expect(resolveInside("/tmp/docs-share", "../secrets")).toBeNull();
    expect(resolveInside("/tmp/docs-share", "/etc/passwd")).toBeNull();
  });
});

describe("resolveRealPathInside", () => {
  let baseDir: string;
  let realBase: string;
  let outsideDir: string;
  let secretFile: string;

  beforeAll(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "ds-worktree-"));
    realBase = await realpath(baseDir);
    outsideDir = await mkdtemp(join(tmpdir(), "ds-outside-"));
    secretFile = join(outsideDir, "secret.txt");
    await writeFile(secretFile, "host-only secret");

    // A legitimate in-base file.
    await writeFile(join(baseDir, "report.html"), "<h1>ok</h1>");
    await mkdir(join(baseDir, "docs"), { recursive: true });
    await writeFile(join(baseDir, "docs", "index.html"), "<h1>docs</h1>");

    // A symlink INSIDE the base pointing at an OUTSIDE absolute file.
    await symlink(secretFile, join(baseDir, "escape.html"));
    // A symlinked directory escaping the base.
    await symlink(outsideDir, join(baseDir, "escape-dir"));
  });

  afterAll(async () => {
    await rm(baseDir, { recursive: true, force: true }).catch(() => {});
    await rm(outsideDir, { recursive: true, force: true }).catch(() => {});
  });

  test("resolves a real in-base file (to its realpath)", async () => {
    const resolved = await resolveRealPathInside(baseDir, "report.html");
    expect(resolved).toBe(join(realBase, "report.html"));
  });

  test("refuses a symlink that escapes the base directory", async () => {
    expect(await resolveRealPathInside(baseDir, "escape.html")).toBeNull();
  });

  test("refuses a path under a symlinked directory escaping the base", async () => {
    expect(
      await resolveRealPathInside(baseDir, "escape-dir/secret.txt")
    ).toBeNull();
  });

  test("returns a contained path for a non-existent leaf (callers then 404 via stat)", async () => {
    // Non-existent but lexically/really contained: returns the projected path,
    // never null, so directory-index resolution still works. A subsequent stat
    // is what produces the 404.
    expect(await resolveRealPathInside(baseDir, "nope.html")).toBe(
      join(realBase, "nope.html")
    );
  });

  test("still rejects lexical traversal and absolute paths", async () => {
    expect(await resolveRealPathInside(baseDir, "../secret.txt")).toBeNull();
    expect(await resolveRealPathInside(baseDir, "/etc/passwd")).toBeNull();
  });
});

describe("redactInternalPaths", () => {
  test("replaces the DATA_DIR prefix with a placeholder", () => {
    const dataDir = "/srv/docs-share/data";
    const msg = `fatal: could not read ${dataDir}/worktrees/repo123/x: No such file`;
    const redacted = redactInternalPaths(msg, [dataDir]);
    expect(redacted).not.toContain(dataDir);
    expect(redacted).not.toContain("/worktrees/repo123");
    expect(redacted).toContain("[path]");
  });

  test("strips temp/clone and home paths even when not in the base list", () => {
    const msg =
      "error: unable to write file /tmp/ds-delete-abc/repo/.git/objects/pack and /home/runner/secret";
    const redacted = redactInternalPaths(msg, ["/srv/docs-share/data"]);
    expect(redacted).not.toContain("/tmp/ds-delete-abc");
    expect(redacted).not.toContain("/home/runner/secret");
    expect(redacted).toContain("[path]");
  });

  test("leaves non-path text intact", () => {
    expect(redactInternalPaths("nothing to commit", [])).toBe(
      "nothing to commit"
    );
  });
});

describe("safeNextPath", () => {
  test("accepts safe same-origin paths", () => {
    expect(safeNextPath("/view/public/abc123")).toBe("/view/public/abc123");
    expect(safeNextPath("/view/public/abc/report.html?x=1")).toBe(
      "/view/public/abc/report.html?x=1"
    );
    expect(safeNextPath("/app")).toBe("/app");
  });

  test("rejects missing, relative, absolute, and tricky paths", () => {
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath("")).toBeNull();
    expect(safeNextPath("app")).toBeNull();
    expect(safeNextPath("https://evil.com")).toBeNull();
    expect(safeNextPath("//evil.com")).toBeNull();
    expect(safeNextPath("/" + String.fromCharCode(92) + "evil.com")).toBeNull(); // backslash trick
    expect(safeNextPath("/foo" + String.fromCharCode(10) + "bar")).toBeNull(); // control char
    expect(safeNextPath("/foo" + String.fromCharCode(127) + "bar")).toBeNull(); // DEL
  });
});

describe("isPrivateOrLoopbackHost", () => {
  test("flags loopback, private, link-local, and internal hosts", () => {
    expect(isPrivateOrLoopbackHost("localhost")).toBe(true);
    expect(isPrivateOrLoopbackHost("api.localhost")).toBe(true);
    expect(isPrivateOrLoopbackHost("db.internal")).toBe(true);
    expect(isPrivateOrLoopbackHost("printer.local")).toBe(true);
    expect(isPrivateOrLoopbackHost("127.0.0.1")).toBe(true);
    expect(isPrivateOrLoopbackHost("0.0.0.0")).toBe(true);
    expect(isPrivateOrLoopbackHost("10.0.0.5")).toBe(true);
    expect(isPrivateOrLoopbackHost("172.16.4.1")).toBe(true);
    expect(isPrivateOrLoopbackHost("172.31.255.255")).toBe(true);
    expect(isPrivateOrLoopbackHost("192.168.1.1")).toBe(true);
    expect(isPrivateOrLoopbackHost("169.254.1.1")).toBe(true);
    expect(isPrivateOrLoopbackHost("100.64.0.1")).toBe(true);
    expect(isPrivateOrLoopbackHost("::1")).toBe(true);
    expect(isPrivateOrLoopbackHost("[::1]")).toBe(true);
    expect(isPrivateOrLoopbackHost("fe80::1")).toBe(true);
    expect(isPrivateOrLoopbackHost("fc00::1")).toBe(true);
    expect(isPrivateOrLoopbackHost("fd00::1")).toBe(true);
    expect(isPrivateOrLoopbackHost("::")).toBe(true);
    expect(isPrivateOrLoopbackHost("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateOrLoopbackHost("")).toBe(true);
  });

  test("blocks IPv4-mapped IPv6 in hex-compressed and expanded forms (SSRF bypass)", () => {
    // The bracketed-host normalization Node/Bun apply turns "[::ffff:127.0.0.1]"
    // into the hex-compressed "::ffff:7f00:1" — both must be blocked.
    expect(isPrivateOrLoopbackHost("::ffff:7f00:1")).toBe(true); // 127.0.0.1
    expect(isPrivateOrLoopbackHost("::ffff:0a00:1")).toBe(true); // 10.0.0.1
    expect(isPrivateOrLoopbackHost("::ffff:c0a8:1")).toBe(true); // 192.168.0.1
    expect(isPrivateOrLoopbackHost("[::ffff:7f00:1]")).toBe(true);
    expect(isPrivateOrLoopbackHost("0:0:0:0:0:ffff:7f00:1")).toBe(true); // expanded
  });

  test("allows routable public hosts", () => {
    expect(isPrivateOrLoopbackHost("example.com")).toBe(false);
    expect(isPrivateOrLoopbackHost("hooks.example.com")).toBe(false);
    expect(isPrivateOrLoopbackHost("8.8.8.8")).toBe(false);
    expect(isPrivateOrLoopbackHost("93.184.216.34")).toBe(false);
    expect(isPrivateOrLoopbackHost("172.32.0.1")).toBe(false);
    expect(isPrivateOrLoopbackHost("2606:4700:4700::1111")).toBe(false);
  });
});

describe("validateWebhookUrl", () => {
  test("accepts public http(s) URLs", () => {
    expect(validateWebhookUrl("https://hooks.example.com/in")).toBe(
      "https://hooks.example.com/in"
    );
    expect(validateWebhookUrl("http://example.com/webhook")).toBe(
      "http://example.com/webhook"
    );
  });

  test("rejects non-http schemes, credentials, and private targets", () => {
    expect(validateWebhookUrl(null)).toBeNull();
    expect(validateWebhookUrl("")).toBeNull();
    expect(validateWebhookUrl("not a url")).toBeNull();
    expect(validateWebhookUrl("ftp://example.com")).toBeNull();
    expect(validateWebhookUrl("file:///etc/passwd")).toBeNull();
    expect(validateWebhookUrl("https://user:pass@example.com")).toBeNull();
    expect(validateWebhookUrl("http://localhost:3000/hook")).toBeNull();
    expect(validateWebhookUrl("http://127.0.0.1/hook")).toBeNull();
    expect(validateWebhookUrl("http://169.254.169.254/latest/meta-data")).toBeNull();
    expect(validateWebhookUrl("http://[::1]:8080/hook")).toBeNull();
    expect(validateWebhookUrl("http://192.168.0.10/hook")).toBeNull();
  });
});

describe("resolveAndValidateHost", () => {
  test("returns resolved addresses when all are public", async () => {
    const addresses = await resolveAndValidateHost(
      "hooks.example.com",
      async () => [{ address: "93.184.216.34", family: 4 }]
    );
    expect(addresses).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });

  test("rejects when the hostname resolves to a private IP", async () => {
    await expect(
      resolveAndValidateHost("evil.example.com", async () => [
        { address: "169.254.169.254", family: 4 },
      ])
    ).rejects.toThrow(/non-routable/);
  });

  test("rejects when ANY of multiple resolved addresses is private", async () => {
    await expect(
      resolveAndValidateHost("evil.example.com", async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.1", family: 4 },
      ])
    ).rejects.toThrow(/non-routable/);
  });

  test("rejects when DNS resolves to nothing", async () => {
    await expect(
      resolveAndValidateHost("nx.example.com", async () => [])
    ).rejects.toThrow(/did not resolve/);
  });

  test("validates IP-literal hosts directly without DNS", async () => {
    let lookupCalled = false;
    await expect(
      resolveAndValidateHost("127.0.0.1", async () => {
        lookupCalled = true;
        return [];
      })
    ).rejects.toThrow(/non-routable/);
    expect(lookupCalled).toBe(false);

    const addresses = await resolveAndValidateHost("8.8.8.8", async () => {
      lookupCalled = true;
      return [];
    });
    expect(addresses).toEqual([{ address: "8.8.8.8", family: 4 }]);
    expect(lookupCalled).toBe(false);
  });
});
