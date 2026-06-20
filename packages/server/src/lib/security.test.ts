import { describe, expect, test } from "bun:test";
import {
  assertProductionSecret,
  isProduction,
  normalizeRelativePath,
  resolveInside,
  safeNextPath,
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
