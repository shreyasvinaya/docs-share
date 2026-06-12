import { describe, expect, test } from "bun:test";
import { buildSignedContentUrl, validContentSignature } from "./drafts.js";

describe("draft route helpers", () => {
  test("builds signed content URLs on CONTENT_ORIGIN", () => {
    const url = new URL(buildSignedContentUrl("dr_123", "abc123"));

    expect(url.origin).toBe("http://localhost:3000");
    expect(url.pathname).toBe("/draft-content/dr_123");
    expect(url.searchParams.get("exp")).toBeTruthy();
    expect(url.searchParams.get("sig")).toBeTruthy();
  });

  test("validates signatures only for the matching draft and content hash", () => {
    const url = new URL(buildSignedContentUrl("dr_123", "abc123"));
    const exp = url.searchParams.get("exp") ?? undefined;
    const sig = url.searchParams.get("sig") ?? undefined;

    expect(validContentSignature("dr_123", "abc123", exp, sig)).toBe(true);
    expect(validContentSignature("dr_456", "abc123", exp, sig)).toBe(false);
    expect(validContentSignature("dr_123", "changed", exp, sig)).toBe(false);
    expect(validContentSignature("dr_123", "abc123", "1", sig)).toBe(false);
    expect(validContentSignature("dr_123", "abc123", exp, "bad")).toBe(false);
  });
});
