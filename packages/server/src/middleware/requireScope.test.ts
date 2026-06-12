import { describe, expect, test } from "bun:test";
import { hasScope } from "./requireScope.js";

describe("hasScope", () => {
  test("allows exact, wildcard, and resource wildcard scopes", () => {
    expect(hasScope("draft:write", "draft:write")).toBe(true);
    expect(hasScope("draft:*", "draft:write")).toBe(true);
    expect(hasScope("*", "draft:write")).toBe(true);
  });

  test("rejects unrelated scopes", () => {
    expect(hasScope("git:write", "draft:write")).toBe(false);
    expect(hasScope("draft:read", "draft:write")).toBe(false);
  });
});
