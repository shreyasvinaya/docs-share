import { describe, expect, test } from "bun:test";
import { validatePathSegments } from "./target.js";

describe("validatePathSegments (M2 client-side path sanitization)", () => {
  test("accepts an empty path (root)", () => {
    expect(() => validatePathSegments("")).not.toThrow();
  });

  test("accepts a normal nested path", () => {
    expect(() => validatePathSegments("docs/reports/2024")).not.toThrow();
    expect(() => validatePathSegments("a-file_name.md")).not.toThrow();
  });

  test("rejects .. traversal in any segment", () => {
    expect(() => validatePathSegments("..")).toThrow(/traversal/);
    expect(() => validatePathSegments("docs/../etc")).toThrow(/traversal/);
    expect(() => validatePathSegments("a/b/..")).toThrow(/traversal/);
  });

  test("rejects an absolute path", () => {
    expect(() => validatePathSegments("/etc/passwd")).toThrow(/absolute/);
  });

  test("rejects an empty or '.' segment", () => {
    expect(() => validatePathSegments("a//b")).toThrow(/empty or/);
    expect(() => validatePathSegments("a/./b")).toThrow(/empty or/);
  });

  test("rejects backslashes (alt separator on some servers)", () => {
    expect(() => validatePathSegments("a\\b")).toThrow(/backslash/);
    expect(() => validatePathSegments("..\\windows")).toThrow();
  });

  test("rejects NUL and control characters", () => {
    expect(() => validatePathSegments("a\u0000b")).toThrow(/control/);
    expect(() => validatePathSegments("a\nb")).toThrow(/control/);
    expect(() => validatePathSegments("tab\there")).toThrow(/control/);
    expect(() => validatePathSegments("del\u007f")).toThrow(/control/);
  });

  test("uses the provided label in the error message", () => {
    expect(() => validatePathSegments("..", "subfolder")).toThrow(/subfolder/);
    expect(() => validatePathSegments("..", "file name")).toThrow(/file name/);
  });
});
