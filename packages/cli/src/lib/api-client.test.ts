import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ApiClient } from "./api-client.js";
import { NetworkError } from "./errors.js";

// We mock globalThis.fetch per-test and restore it afterwards.
const realFetch = globalThis.fetch;

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {}
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

/** Install a fetch mock without fighting the full `typeof fetch` shape. */
function mockFetch(
  impl: (url: string, init: RequestInit) => Promise<Response>
): void {
  globalThis.fetch = impl as unknown as typeof fetch;
}

function makeClient(
  overrides: Partial<ConstructorParameters<typeof ApiClient>[0]> = {}
) {
  return new ApiClient({
    apiUrl: "https://api.example.com",
    token: "tkn_secret",
    // Keep tests fast: tiny backoff base.
    retryBaseMs: 1,
    ...overrides,
  });
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("ApiClient redirect handling", () => {
  test("does NOT follow a redirect (token never resent) and throws NetworkError", async () => {
    let calls = 0;
    let usedRedirect: RequestRedirect | undefined;
    mockFetch(async (_url, init) => {
      calls++;
      usedRedirect = init.redirect;
      // Simulate a manual-mode 3xx response.
      return new Response(null, {
        status: 302,
        headers: { location: "https://evil.example.com/" },
      });
    });

    const client = makeClient();
    await expect(client.get("/api/auth/session")).rejects.toThrow(NetworkError);
    await expect(client.get("/api/auth/session")).rejects.toThrow(
      /Refusing to follow redirect/
    );
    // redirect must be set to manual so fetch never auto-follows with the token.
    expect(usedRedirect).toBe("manual");
    expect(calls).toBeGreaterThan(0);
  });

  test("treats opaqueredirect responses as an error", async () => {
    // A real opaqueredirect Response has status 0, which the Response
    // constructor rejects. Mock the minimal shape the client inspects.
    mockFetch(async () => {
      return {
        type: "opaqueredirect",
        status: 0,
        ok: false,
        headers: new Headers(),
      } as unknown as Response;
    });

    const client = makeClient();
    await expect(client.get("/x")).rejects.toThrow(/Refusing to follow redirect/);
  });
});

describe("ApiClient plaintext-http warning", () => {
  let warnings: string[];
  let originalWrite: typeof process.stderr.write;

  beforeEach(() => {
    warnings = [];
    originalWrite = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      warnings.push(
        typeof chunk === "string" ? chunk : Buffer.from(chunk).toString()
      );
      return true;
    }) as typeof process.stderr.write;
  });

  afterEach(() => {
    process.stderr.write = originalWrite;
  });

  test("warns for non-localhost http", async () => {
    mockFetch(async () => jsonResponse({ ok: true }));
    const client = makeClient({ apiUrl: "http://docs.internal.example.com" });
    await client.get("/x");
    expect(warnings.join("")).toMatch(/unencrypted connection/i);
  });

  test("does NOT warn for localhost http", async () => {
    mockFetch(async () => jsonResponse({ ok: true }));
    const client = makeClient({ apiUrl: "http://localhost:3000" });
    await client.get("/x");
    expect(warnings.join("")).not.toMatch(/unencrypted/i);
  });

  test("does NOT warn for 127.0.0.1 http", async () => {
    mockFetch(async () => jsonResponse({ ok: true }));
    const client = makeClient({ apiUrl: "http://127.0.0.1:8080" });
    await client.get("/x");
    expect(warnings.join("")).not.toMatch(/unencrypted/i);
  });

  test("does NOT warn for https", async () => {
    mockFetch(async () => jsonResponse({ ok: true }));
    const client = makeClient({ apiUrl: "https://api.example.com" });
    await client.get("/x");
    expect(warnings.join("")).not.toMatch(/unencrypted/i);
  });

  test("warns only once per client across multiple requests", async () => {
    mockFetch(async () => jsonResponse({ ok: true }));
    const client = makeClient({ apiUrl: "http://docs.internal.example.com" });
    await client.get("/a");
    await client.get("/b");
    const count = warnings.filter((w) => /unencrypted/i.test(w)).length;
    expect(count).toBe(1);
  });
});

describe("ApiClient URL validation", () => {
  test("rejects a non-http(s) scheme", () => {
    expect(
      () => new ApiClient({ apiUrl: "ftp://example.com", token: "t" })
    ).toThrow(/must use http/);
  });

  test("rejects garbage that is not a URL", () => {
    expect(() => new ApiClient({ apiUrl: "not a url", token: "t" })).toThrow(
      /not a valid URL/
    );
  });

  test("accepts a valid https URL", () => {
    expect(
      () => new ApiClient({ apiUrl: "https://ok.example.com", token: "t" })
    ).not.toThrow();
  });
});

describe("ApiClient timeout", () => {
  test("aborts and throws NetworkError on timeout", async () => {
    mockFetch((_url, init) => {
      return new Promise((_resolve, reject) => {
        // Never resolve; reject when aborted (mimicking real fetch).
        const signal = init.signal;
        if (signal) {
          signal.addEventListener("abort", () => {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        }
      });
    });

    const client = makeClient({ timeoutMs: 20 });
    await expect(client.get("/slow")).rejects.toThrow(NetworkError);
    await expect(client.get("/slow")).rejects.toThrow(/timed out after/);
  });
});

describe("ApiClient retries (idempotent only)", () => {
  test("retries GET on 503 then succeeds", async () => {
    let calls = 0;
    mockFetch(async () => {
      calls++;
      if (calls < 3) return jsonResponse({ error: "down" }, { status: 503 });
      return jsonResponse({ ok: true });
    });

    const client = makeClient({ maxRetries: 3, retryBaseMs: 1 });
    const res = await client.get<{ ok: boolean }>("/x");
    expect(res.ok).toBe(true);
    expect(calls).toBe(3);
  });

  test("retries GET on 429 honoring Retry-After header", async () => {
    let calls = 0;
    mockFetch(async () => {
      calls++;
      if (calls === 1) {
        return jsonResponse(
          { error: "slow down" },
          { status: 429, headers: { "retry-after": "0" } }
        );
      }
      return jsonResponse({ ok: true });
    });

    const client = makeClient({ maxRetries: 3, retryBaseMs: 1 });
    const res = await client.get<{ ok: boolean }>("/x");
    expect(res.ok).toBe(true);
    expect(calls).toBe(2);
  });

  test("Retry-After delay is actually honored (waits ~the header value)", async () => {
    let calls = 0;
    mockFetch(async () => {
      calls++;
      if (calls === 1) {
        return jsonResponse(
          { error: "slow down" },
          { status: 503, headers: { "retry-after": "1" } }
        );
      }
      return jsonResponse({ ok: true });
    });

    const start = Date.now();
    // Tiny base would normally retry near-instantly; Retry-After: 1 forces ~1s.
    const client = makeClient({ maxRetries: 3, retryBaseMs: 1 });
    await client.get("/x");
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(900);
  });

  test("retries GET on network error then succeeds", async () => {
    let calls = 0;
    mockFetch(async () => {
      calls++;
      if (calls < 2) throw new TypeError("network down");
      return jsonResponse({ ok: true });
    });

    const client = makeClient({ maxRetries: 3, retryBaseMs: 1 });
    const res = await client.get<{ ok: boolean }>("/x");
    expect(res.ok).toBe(true);
    expect(calls).toBe(2);
  });

  test("gives up after maxRetries and throws", async () => {
    let calls = 0;
    mockFetch(async () => {
      calls++;
      return jsonResponse({ error: "down" }, { status: 503 });
    });

    const client = makeClient({ maxRetries: 3, retryBaseMs: 1 });
    await expect(client.get("/x")).rejects.toThrow();
    expect(calls).toBe(3);
  });

  test("does NOT retry POST on 503", async () => {
    let calls = 0;
    mockFetch(async () => {
      calls++;
      return jsonResponse({ error: "down" }, { status: 503 });
    });

    const client = makeClient({ maxRetries: 3, retryBaseMs: 1 });
    await expect(client.post("/x", { a: 1 })).rejects.toThrow();
    expect(calls).toBe(1);
  });

  test("does NOT retry upload on network error", async () => {
    let calls = 0;
    mockFetch(async () => {
      calls++;
      throw new TypeError("network down");
    });

    const client = makeClient({ maxRetries: 3, retryBaseMs: 1 });
    await expect(client.upload("/x", new FormData())).rejects.toThrow(
      NetworkError
    );
    expect(calls).toBe(1);
  });

  test("does NOT retry GET on a non-retryable 400", async () => {
    let calls = 0;
    mockFetch(async () => {
      calls++;
      return jsonResponse({ error: "bad" }, { status: 400 });
    });

    const client = makeClient({ maxRetries: 3, retryBaseMs: 1 });
    await expect(client.get("/x")).rejects.toThrow();
    expect(calls).toBe(1);
  });
});

describe("ApiClient response-size cap (H2)", () => {
  test("rejects when Content-Length exceeds the limit (success path)", async () => {
    mockFetch(async () => {
      return new Response("x".repeat(1000), {
        status: 200,
        headers: { "content-length": "1000", "content-type": "application/json" },
      });
    });

    const client = makeClient({ maxResponseBytes: 100 });
    await expect(client.get("/big")).rejects.toThrow(/too large/i);
  });

  test("rejects early when Content-Length exceeds the limit (error path)", async () => {
    mockFetch(async () => {
      return new Response("x".repeat(50), {
        status: 500,
        headers: { "content-length": "5000" },
      });
    });

    const client = makeClient({ maxResponseBytes: 100 });
    await expect(client.get("/err")).rejects.toThrow(/too large/i);
  });

  test("aborts a body that streams past the cap even with no Content-Length", async () => {
    let chunksSent = 0;
    mockFetch(async () => {
      // 10 chunks of 50 bytes = 500 bytes, no content-length header.
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (chunksSent >= 10) {
            controller.close();
            return;
          }
          chunksSent++;
          controller.enqueue(new Uint8Array(50));
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const client = makeClient({ maxResponseBytes: 120 });
    await expect(client.get("/stream")).rejects.toThrow(/too large/i);
    // The reader should have aborted well before draining all 10 chunks.
    expect(chunksSent).toBeLessThan(10);
  });

  test("accepts a body within the cap", async () => {
    mockFetch(async () => jsonResponse({ ok: true }));
    const client = makeClient({ maxResponseBytes: 1024 });
    const res = await client.get<{ ok: boolean }>("/small");
    expect(res.ok).toBe(true);
  });

  test("error too-large surfaces even when error body is huge", async () => {
    mockFetch(async () => {
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array(500));
          controller.close();
        },
      });
      return new Response(stream, { status: 500 });
    });

    const client = makeClient({ maxResponseBytes: 100 });
    await expect(client.get("/err")).rejects.toThrow(/too large/i);
  });
});

describe("ApiClient loopback detection (L1)", () => {
  let warnings: string[];
  let originalWrite: typeof process.stderr.write;

  beforeEach(() => {
    warnings = [];
    originalWrite = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      warnings.push(
        typeof chunk === "string" ? chunk : Buffer.from(chunk).toString()
      );
      return true;
    }) as typeof process.stderr.write;
  });

  afterEach(() => {
    process.stderr.write = originalWrite;
  });

  async function warnsFor(apiUrl: string): Promise<boolean> {
    mockFetch(async () => jsonResponse({ ok: true }));
    const client = makeClient({ apiUrl });
    await client.get("/x");
    return /unencrypted/i.test(warnings.join(""));
  }

  test("does NOT warn for 127.0.0.5 (whole 127.0.0.0/8 is loopback)", async () => {
    expect(await warnsFor("http://127.0.0.5:8080")).toBe(false);
  });

  test("does NOT warn for 127.255.255.254", async () => {
    expect(await warnsFor("http://127.255.255.254")).toBe(false);
  });

  test("does NOT warn for ::1 (IPv6 loopback)", async () => {
    expect(await warnsFor("http://[::1]:3000")).toBe(false);
  });

  test("does NOT warn for IPv4-mapped loopback ::ffff:127.0.0.1", async () => {
    expect(await warnsFor("http://[::ffff:127.0.0.1]:3000")).toBe(false);
  });

  test("WARNS for a public IP over http", async () => {
    expect(await warnsFor("http://8.8.8.8")).toBe(true);
  });

  test("WARNS for a near-but-not-loopback 128.0.0.1", async () => {
    expect(await warnsFor("http://128.0.0.1")).toBe(true);
  });
});

describe("ApiClient userinfo redaction in errors (L2)", () => {
  // These clients use non-local http URLs, which also fire the plaintext-token
  // warning to stderr. Swallow it so the test output stays clean.
  let originalWrite: typeof process.stderr.write;
  beforeEach(() => {
    originalWrite = process.stderr.write;
    process.stderr.write = (() => true) as typeof process.stderr.write;
  });
  afterEach(() => {
    process.stderr.write = originalWrite;
  });

  test("redirect error does not leak url userinfo", async () => {
    mockFetch(async () => {
      return new Response(null, {
        status: 302,
        headers: { location: "https://user:secretpw@evil.example.com/" },
      });
    });

    const client = new ApiClient({
      apiUrl: "http://alice:hunter2@docs.example.com",
      token: "t",
      retryBaseMs: 1,
    });
    let message = "";
    try {
      await client.get("/x");
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toMatch(/Refusing to follow redirect/);
    // Neither the request URL creds nor the redirect target creds leak.
    expect(message).not.toContain("hunter2");
    expect(message).not.toContain("alice");
    expect(message).not.toContain("secretpw");
  });

  test("timeout error does not leak url userinfo", async () => {
    mockFetch((_url, init) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });

    const client = new ApiClient({
      apiUrl: "http://bob:topsecret@docs.example.com",
      token: "t",
      timeoutMs: 20,
      maxRetries: 1,
    });
    let message = "";
    try {
      await client.get("/slow");
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toMatch(/timed out/);
    expect(message).not.toContain("topsecret");
    expect(message).not.toContain("bob");
  });
});
