import { describe, expect, test } from "bun:test";
import {
  assertProductionSecret,
  isProduction,
  normalizeRelativePath,
  resolveInside,
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

  test("allows strong production secrets and dev defaults outside production", () => {
    expect(() =>
      assertProductionSecret("SESSION_SECRET", "x".repeat(32), {
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
