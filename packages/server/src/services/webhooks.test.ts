import { describe, expect, test } from "bun:test";
import { createHmac } from "crypto";
import {
  buildWebhookPayload,
  generateWebhookSecret,
  signWebhookPayload,
  verifyWebhookSignature,
} from "./webhooks.js";

describe("webhook signing", () => {
  test("signs the exact serialized body with HMAC-SHA256", () => {
    const body = JSON.stringify({ hello: "world" });
    const secret = "whsec_test_secret";

    const signature = signWebhookPayload(body, secret);
    const expected = createHmac("sha256", secret).update(body).digest("hex");

    expect(signature).toBe(`sha256=${expected}`);
  });

  test("verifies matching signatures and rejects tampered bodies", () => {
    const secret = "whsec_test_secret";
    const body = JSON.stringify({ event: "share.created" });
    const signature = signWebhookPayload(body, secret);

    expect(verifyWebhookSignature(body, signature, secret)).toBe(true);
    expect(verifyWebhookSignature(body + " ", signature, secret)).toBe(false);
    expect(verifyWebhookSignature(body, signature, "other-secret")).toBe(false);
    expect(verifyWebhookSignature(body, "sha256=deadbeef", secret)).toBe(false);
    expect(verifyWebhookSignature(body, "garbage", secret)).toBe(false);
  });

  test("generates unique prefixed secrets", () => {
    const a = generateWebhookSecret();
    const b = generateWebhookSecret();
    expect(a).toMatch(/^whsec_/);
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(20);
  });
});

describe("webhook payload shape", () => {
  test("wraps event name, timestamp, and data", () => {
    const payload = buildWebhookPayload("share.created", {
      shareId: "sh_1",
      shareType: "email",
    });
    const parsed = JSON.parse(payload) as {
      event: string;
      data: Record<string, unknown>;
      deliveredAt: string;
    };

    expect(parsed.event).toBe("share.created");
    expect(parsed.data).toEqual({ shareId: "sh_1", shareType: "email" });
    expect(typeof parsed.deliveredAt).toBe("string");
    expect(Number.isNaN(Date.parse(parsed.deliveredAt))).toBe(false);
  });
});
