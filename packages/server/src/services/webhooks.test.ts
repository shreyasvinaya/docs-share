import { describe, expect, test } from "bun:test";
import { createHmac } from "crypto";
import { createServer } from "http";
import type { AddressInfo } from "net";
import {
  buildWebhookPayload,
  defaultSendPinnedRequest,
  deliverWebhook,
  generateWebhookSecret,
  scheduleWebhookDispatch,
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

describe("deliverWebhook SSRF / DNS-rebinding guard", () => {
  const baseParams = {
    url: "https://hooks.example.com/in",
    secret: "whsec_test_secret",
    body: JSON.stringify({ event: "share.created" }),
  };

  test("rejects a hostname that resolves to a private IP without sending", async () => {
    let requestSent = false;

    const outcome = await deliverWebhook(baseParams, {
      // Public-looking host that resolves to an internal IP (DNS rebinding).
      lookupAll: async () => [{ address: "169.254.169.254", family: 4 }],
      sendRequest: async () => {
        requestSent = true;
        return { statusCode: 200 };
      },
      isProductionEnv: false,
    });

    expect(requestSent).toBe(false);
    expect(outcome.status).toBe("failed");
    expect(outcome.responseCode).toBeNull();
    expect(outcome.attempts).toBe(0);
    expect(outcome.error).toContain("non-routable");
  });

  test("rejects when ANY resolved address is private (mixed result)", async () => {
    let requestSent = false;

    const outcome = await deliverWebhook(baseParams, {
      lookupAll: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.5", family: 4 },
      ],
      sendRequest: async () => {
        requestSent = true;
        return { statusCode: 200 };
      },
      isProductionEnv: false,
    });

    expect(requestSent).toBe(false);
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toContain("non-routable");
  });

  test("accepts a public-resolving host and pins the connection to the validated IP", async () => {
    let pinnedAddress = "";
    let requestedHost = "";

    const outcome = await deliverWebhook(baseParams, {
      lookupAll: async () => [{ address: "93.184.216.34", family: 4 }],
      sendRequest: async (req) => {
        // The sender receives the pre-validated IP to pin the socket to, while
        // the URL/Host stays the original hostname for TLS cert validation.
        pinnedAddress = req.pinnedAddress.address;
        requestedHost = req.url.hostname;
        return { statusCode: 200 };
      },
      isProductionEnv: false,
    });

    expect(outcome.status).toBe("success");
    expect(outcome.responseCode).toBe(200);
    expect(outcome.attempts).toBe(1);
    expect(pinnedAddress).toBe("93.184.216.34");
    expect(requestedHost).toBe("hooks.example.com");
  });

  test("signs the delivered body with the webhook secret", async () => {
    let sentSignature: string | undefined;

    await deliverWebhook(baseParams, {
      lookupAll: async () => [{ address: "93.184.216.34", family: 4 }],
      sendRequest: async (req) => {
        sentSignature = req.headers["X-Patra-Signature"];
        return { statusCode: 200 };
      },
      isProductionEnv: false,
    });

    expect(sentSignature).toBe(signWebhookPayload(baseParams.body, baseParams.secret));
  });

  test("enforces https-only in production", async () => {
    let requestSent = false;

    const outcome = await deliverWebhook(
      { ...baseParams, url: "http://hooks.example.com/in" },
      {
        lookupAll: async () => [{ address: "93.184.216.34", family: 4 }],
        sendRequest: async () => {
          requestSent = true;
          return { statusCode: 200 };
        },
        isProductionEnv: true,
      }
    );

    expect(requestSent).toBe(false);
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toContain("https");
  });

  test("allows http in development", async () => {
    let requestSent = false;

    const outcome = await deliverWebhook(
      { ...baseParams, url: "http://hooks.example.com/in" },
      {
        lookupAll: async () => [{ address: "93.184.216.34", family: 4 }],
        sendRequest: async () => {
          requestSent = true;
          return { statusCode: 200 };
        },
        isProductionEnv: false,
      }
    );

    expect(requestSent).toBe(true);
    expect(outcome.status).toBe("success");
  });

  test("rejects an IP-literal internal URL at validation (no DNS, no send)", async () => {
    let lookupCalled = false;
    let requestSent = false;

    const outcome = await deliverWebhook(
      { ...baseParams, url: "http://127.0.0.1/hook" },
      {
        lookupAll: async () => {
          lookupCalled = true;
          return [{ address: "8.8.8.8", family: 4 }];
        },
        sendRequest: async () => {
          requestSent = true;
          return { statusCode: 200 };
        },
        isProductionEnv: false,
      }
    );

    expect(lookupCalled).toBe(false);
    expect(requestSent).toBe(false);
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toContain("validation");
  });
});

describe("scheduleWebhookDispatch (fire-and-forget)", () => {
  test("returns synchronously and never throws into the request path", () => {
    // No webhooks exist for this owner, so dispatch resolves with no deliveries.
    // The contract under test: scheduling returns a promise immediately and the
    // caller (request handler) is never forced to await delivery, and errors —
    // if any — are swallowed rather than propagated.
    const result = scheduleWebhookDispatch({
      ownerUserId: `nonexistent_${Date.now()}`,
      event: "share.created",
      data: { shareId: "sh_test" },
    });
    expect(result).toBeInstanceOf(Promise);
    // The returned promise must resolve (never reject), even on internal error.
    return expect(result).resolves.toBeUndefined();
  });

  test("does not reject even when dispatch lookup would fail", async () => {
    // Owner id is irrelevant; any internal failure inside dispatch must be
    // caught and logged, leaving the returned promise resolved.
    await expect(
      scheduleWebhookDispatch({
        ownerUserId: "",
        event: "github_sync.completed",
        data: {},
      })
    ).resolves.toBeUndefined();
  });
});

describe("defaultSendPinnedRequest connection pinning (real socket)", () => {
  // Exercises the REAL sender (not a stub) to prove the connection is pinned to
  // the validated IP under the actual runtime. The prior implementation relied
  // on an agent `lookup` which Bun ignores, so the pin was dead code; this test
  // would fail under that regression because the request would try to resolve
  // the (non-loopback) URL hostname instead of connecting to the pinned IP.
  test("connects to the pinned IP, not the URL hostname, and preserves Host", async () => {
    const received: { host?: string; url?: string; body: string } = { body: "" };
    const server = createServer((req, res) => {
      received.host = req.headers.host;
      received.url = req.url;
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        received.body = body;
        res.writeHead(200);
        res.end("ok");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      // The URL hostname is a domain that does NOT resolve to loopback. The only
      // way this request reaches our 127.0.0.1 server is if the sender connects
      // to the PINNED address — proving the pin (and catching the Bun dead-pin
      // regression, which would instead try to resolve the hostname).
      const res = await defaultSendPinnedRequest({
        url: new URL(`http://pin-test.invalid:${port}/hook/path?x=1`),
        pinnedAddress: { address: "127.0.0.1", family: 4 },
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ping: true }),
      });

      expect(res.statusCode).toBe(200);
      expect(received.url).toBe("/hook/path?x=1");
      // Host header preserves the original hostname:port, not the IP.
      expect(received.host).toBe(`pin-test.invalid:${port}`);
      expect(received.body).toBe(JSON.stringify({ ping: true }));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
