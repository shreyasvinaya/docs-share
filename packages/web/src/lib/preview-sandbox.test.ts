import { expect, test } from "bun:test";
import {
  PREVIEW_IFRAME_SANDBOX,
  isOpaqueOriginSandbox,
} from "./preview-sandbox";

test("preview iframe sandbox allows scripts but stays in an opaque origin", () => {
  // Legit document scripts still run...
  expect(PREVIEW_IFRAME_SANDBOX).toContain("allow-scripts");
  // ...but the framed content can never re-acquire the host origin.
  expect(PREVIEW_IFRAME_SANDBOX).not.toContain("allow-same-origin");
  expect(isOpaqueOriginSandbox(PREVIEW_IFRAME_SANDBOX)).toBe(true);
});

test("isOpaqueOriginSandbox flags an allow-same-origin escape", () => {
  expect(isOpaqueOriginSandbox("allow-scripts")).toBe(true);
  expect(isOpaqueOriginSandbox("allow-scripts allow-same-origin")).toBe(false);
  expect(isOpaqueOriginSandbox("allow-same-origin allow-scripts")).toBe(false);
  // Case/whitespace robustness.
  expect(isOpaqueOriginSandbox("  ALLOW-SAME-ORIGIN ")).toBe(false);
});
