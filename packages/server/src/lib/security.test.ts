import { describe, expect, test } from "bun:test";
import {
  assertProductionSecret,
  isPrivateOrLoopbackHost,
  isProduction,
  normalizeRelativePath,
  resolveAndValidateHost,
  resolveInside,
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
