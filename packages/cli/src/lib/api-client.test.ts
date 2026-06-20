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
