import { describe, expect, test } from "bun:test";
import { shareScopeCovers } from "./shareAccess.js";

describe("shareScopeCovers", () => {
  test("a whole-repo share (null/empty scope) covers any target", () => {
    expect(shareScopeCovers(null, "")).toBe(true);
    expect(shareScopeCovers(null, "docs/report.html")).toBe(true);
    expect(shareScopeCovers("", "anything/deep")).toBe(true);
    expect(shareScopeCovers(undefined, "x")).toBe(true);
  });

  test("a path-scoped share covers its own path and descendants", () => {
    expect(shareScopeCovers("docs", "docs")).toBe(true);
    expect(shareScopeCovers("docs", "docs/report.html")).toBe(true);
    expect(shareScopeCovers("docs", "docs/sub/deep.html")).toBe(true);
  });

  test("a path-scoped share does NOT cover the whole repo or sibling paths", () => {
    // Whole-repo operation requires a repo-wide grant.
    expect(shareScopeCovers("docs", "")).toBe(false);
    expect(shareScopeCovers("docs", null)).toBe(false);
    // Sibling / prefix-collision paths are not covered.
    expect(shareScopeCovers("docs", "other/report.html")).toBe(false);
    expect(shareScopeCovers("docs", "docs2/report.html")).toBe(false);
    expect(shareScopeCovers("docs", "do")).toBe(false);
  });

  test("unsafe paths are never covered", () => {
    expect(shareScopeCovers("docs", "../escape")).toBe(false);
    expect(shareScopeCovers("../bad", "docs/x")).toBe(false);
  });
});
