import {
  getToken,
  getApiUrl,
  validateApiUrl,
  getTimeoutMs,
  getUploadTimeoutMs,
  getMaxRetries,
  getRetryBaseMs,
  getMaxResponseBytes,
  redactUrl,
} from "./config.js";
import {
  CliError,
  AuthError,
  NetworkError,
  NotFoundError,
  PermissionDeniedError,
  EXIT_CODES,
} from "./errors.js";
import { warn } from "./output.js";

export interface ApiClientOptions {
  apiUrl?: string;
  token?: string;
  /** Override the per-request timeout (ms). Mainly for tests. */
  timeoutMs?: number;
  /** Override the upload-request timeout (ms). Mainly for tests. */
  uploadTimeoutMs?: number;
  /** Override the max number of attempts for idempotent (GET) requests. */
  maxRetries?: number;
  /** Override the base backoff delay (ms) between retries. */
  retryBaseMs?: number;
  /** Override the max response-body size (bytes) we'll buffer. */
  maxResponseBytes?: number;
}

/** HTTP status codes worth retrying for idempotent requests. */
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

/** Cap any honored Retry-After / backoff delay so we never hang for minutes. */
const MAX_BACKOFF_MS = 30_000;

/**
 * True if the hostname refers to the local machine. Covers the entire IPv4
 * loopback range 127.0.0.0/8 (not just 127.0.0.1), the IPv6 loopback ::1, and
 * IPv4-mapped loopback (::ffff:127.x.x.x) — any of which a self-hoster might use
 * for a trusted plain-http server.
 */
function isLocalhost(hostname: string): boolean {
  let h = hostname.toLowerCase();
  // Strip the brackets URL puts around IPv6 literals (e.g. "[::1]").
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);

  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "::1") return true;

  // IPv4-mapped IPv6 loopback in dotted form, e.g. ::ffff:127.0.0.1.
  const mappedDotted = h.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  // The URL parser normalizes ::ffff:127.0.0.1 to the hex form ::ffff:7f00:1,
  // so also accept ::ffff:<hi>:<lo> where the high group's top octet is 0x7f
  // (127.x.x.x). The groups are 1-4 hex digits, zero-padded conceptually.
  const mappedHex = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    // Top 8 bits of the 16-bit high group is the first IPv4 octet.
    if (((hi >> 8) & 0xff) === 127) return true;
  }
  const candidate = mappedDotted ? mappedDotted[1] : h;

  // Any address in 127.0.0.0/8 is loopback.
  const v4 = candidate.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const octets = v4.slice(1).map(Number);
    if (octets.every((o) => o >= 0 && o <= 255) && octets[0] === 127) {
      return true;
    }
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse a Retry-After header value into milliseconds. Supports both the
 * delta-seconds form ("120") and the HTTP-date form. Returns undefined when
 * absent or unparseable. The result is clamped to MAX_BACKOFF_MS inside the
 * parser so every caller is safe from a server asking us to sleep for minutes.
 */
function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, MAX_BACKOFF_MS);
  }
  const date = Date.parse(value);
  if (!Number.isNaN(date)) {
    return Math.min(Math.max(0, date - Date.now()), MAX_BACKOFF_MS);
  }
  return undefined;
}

export class ApiClient {
  private baseUrl: string;
  private token: string;
  private timeoutMs: number;
  private uploadTimeoutMs: number;
  private maxRetries: number;
  private retryBaseMs: number;
  private maxResponseBytes: number;
  /** Tracks whether the plaintext-token warning has already been emitted. */
  private warnedPlaintext = false;

  constructor(opts: ApiClientOptions = {}) {
    // getApiUrl validates the URL; an explicit override is validated here too so
    // garbage never reaches fetch().
    const rawUrl = opts.apiUrl ? validateApiUrl(opts.apiUrl, "--api-url") : getApiUrl();
    this.baseUrl = rawUrl.replace(/\/+$/, "");
    this.token = opts.token ?? getToken();
    this.timeoutMs = opts.timeoutMs ?? getTimeoutMs();
    this.uploadTimeoutMs = opts.uploadTimeoutMs ?? getUploadTimeoutMs();
    this.maxRetries = opts.maxRetries ?? getMaxRetries();
    this.retryBaseMs = opts.retryBaseMs ?? getRetryBaseMs();
    this.maxResponseBytes = opts.maxResponseBytes ?? getMaxResponseBytes();
  }

  /**
   * Warn (once per client) if we're about to send the bearer token over an
   * unencrypted connection to a non-local host. We do not hard-fail because
   * self-hosters may run plain http on a trusted LAN.
   */
  private maybeWarnPlaintext(): void {
    if (this.warnedPlaintext) return;
    let url: URL;
    try {
      url = new URL(this.baseUrl);
    } catch {
      return;
    }
    if (url.protocol === "http:" && !isLocalhost(url.hostname)) {
      this.warnedPlaintext = true;
      warn(
        `Sending API token over an unencrypted connection (${url.protocol}//${url.host}). ` +
          `Use https:// to protect your credentials.`
      );
    }
  }

  /**
   * Perform a single fetch with an AbortController-based timeout. Throws a
   * NetworkError on transport failure or timeout, and returns the Response
   * (including non-2xx) otherwise.
   */
  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (err) {
      if (controller.signal.aborted) {
        const secs =
          timeoutMs >= 1000
            ? `${Math.round(timeoutMs / 1000)}s`
            : `${timeoutMs}ms`;
        throw new NetworkError(`request to ${redactUrl(url)} timed out after ${secs}`);
      }
      const message =
        err instanceof Error ? err.message : "Unknown network error";
      throw new NetworkError(
        `Failed to connect to ${redactUrl(this.baseUrl)}: ${message}`
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    options?: { formData?: FormData }
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    // We're about to attach the bearer token — warn if the channel is insecure.
    this.maybeWarnPlaintext();

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
    };

    let fetchBody: BodyInit | undefined;
    const isUpload = options?.formData !== undefined;

    if (isUpload) {
      fetchBody = options!.formData;
      // Do not set Content-Type — fetch will add multipart boundary automatically
    } else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      fetchBody = JSON.stringify(body);
    }

    const timeoutMs = isUpload ? this.uploadTimeoutMs : this.timeoutMs;

    const init: RequestInit = {
      method,
      headers,
      body: fetchBody,
      // Never follow a redirect: a 3xx to another origin could leak the bearer
      // token. We surface redirects as an explicit, actionable error instead.
      redirect: "manual",
    };

    // Only idempotent GET requests are safe to retry automatically. Anything
    // that mutates state (POST/PATCH/DELETE/upload) must run exactly once.
    const idempotent = method === "GET";
    const maxAttempts = idempotent ? Math.max(1, this.maxRetries) : 1;

    let attempt = 0;
    for (;;) {
      attempt++;
      let res: Response;
      try {
        res = await this.fetchWithTimeout(url, init, timeoutMs);
      } catch (err) {
        // Network/timeout failure: retry idempotent requests with backoff.
        if (idempotent && attempt < maxAttempts) {
          await sleep(this.backoffDelay(attempt));
          continue;
        }
        throw err;
      }

      // A redirect with `redirect: "manual"` surfaces as an opaqueredirect
      // response (status 0) or a 3xx, depending on runtime. Treat both as an
      // error so the token is never resent to the redirect target.
      if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
        const location = res.headers.get("location");
        throw new NetworkError(
          `Refusing to follow redirect from ${redactUrl(url)}` +
            (location ? ` to ${redactUrl(location)}` : "") +
            " (would resend the API token to another location). " +
            "Check your API URL points directly at the Patra server."
        );
      }

      if (res.ok) {
        return this.parseSuccess<T>(res);
      }

      // Retry transient server/rate-limit errors for idempotent requests.
      if (
        idempotent &&
        RETRYABLE_STATUSES.has(res.status) &&
        attempt < maxAttempts
      ) {
        const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
        const delay = retryAfter ?? this.backoffDelay(attempt);
        await sleep(Math.min(delay, MAX_BACKOFF_MS));
        continue;
      }

      return this.throwForStatus(res);
    }
  }

  private backoffDelay(attempt: number): number {
    // Exponential backoff: base * 2^(attempt-1), capped.
    return Math.min(this.retryBaseMs * 2 ** (attempt - 1), MAX_BACKOFF_MS);
  }

  /**
   * Read a response body as text, never buffering more than maxResponseBytes.
   *
   * A compromised or buggy server could stream an unbounded body (and may lie
   * about, or omit, Content-Length) to OOM the host. We reject early when the
   * advertised Content-Length is over the cap, and defensively read the stream
   * chunk-by-chunk, aborting the moment the accumulated size exceeds the cap.
   */
  private async readBodyBounded(res: Response): Promise<string> {
    const limit = this.maxResponseBytes;

    // Fast path: trust an honest Content-Length to reject before reading.
    const lenHeader = res.headers.get("content-length");
    if (lenHeader !== null) {
      const len = Number(lenHeader);
      if (Number.isFinite(len) && len > limit) {
        // Free the socket; we're not going to consume this body.
        try {
          await res.body?.cancel();
        } catch {
          // best-effort
        }
        throw new NetworkError(
          `Response body too large: ${len} bytes exceeds the ${limit}-byte limit ` +
            `(raise PATRA_MAX_RESPONSE_BYTES if this is expected).`
        );
      }
    }

    const body = res.body;
    // Some runtimes / mocked responses may not expose a stream; fall back to
    // text() but still enforce the cap on the buffered result.
    if (!body) {
      const text = await res.text();
      if (Buffer.byteLength(text, "utf-8") > limit) {
        throw new NetworkError(
          `Response body too large: exceeds the ${limit}-byte limit ` +
            `(raise PATRA_MAX_RESPONSE_BYTES if this is expected).`
        );
      }
      return text;
    }

    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > limit) {
          throw new NetworkError(
            `Response body too large: exceeds the ${limit}-byte limit ` +
              `(raise PATRA_MAX_RESPONSE_BYTES if this is expected).`
          );
        }
        chunks.push(value);
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        // best-effort: stream may already be closed
      }
    }

    return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf-8");
  }

  private async parseSuccess<T>(res: Response): Promise<T> {
    const text = await this.readBodyBounded(res);
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as T;
    }
  }

  private async throwForStatus(res: Response): Promise<never> {
    let errorBody: { error?: string; details?: unknown } = {};
    try {
      const text = await this.readBodyBounded(res);
      if (text) errorBody = JSON.parse(text) as typeof errorBody;
    } catch (err) {
      // A too-large error body is still a network-level failure worth surfacing.
      if (err instanceof NetworkError) throw err;
      // Otherwise the response body may simply not be JSON — fall through.
    }

    const errorMessage =
      errorBody.error ?? `HTTP ${res.status}: ${res.statusText}`;

    switch (res.status) {
      case 401:
        throw new AuthError(errorMessage);
      case 403:
        throw new PermissionDeniedError(errorMessage);
      case 404:
        throw new NotFoundError(errorMessage);
      default:
        throw new CliError(errorMessage, EXIT_CODES.UNKNOWN);
    }
  }

  async get<T = unknown>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  async post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  async patch<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PATCH", path, body);
  }

  async del<T = unknown>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }

  async upload<T = unknown>(path: string, formData: FormData): Promise<T> {
    return this.request<T>("POST", path, undefined, { formData });
  }
}

let defaultClient: ApiClient | undefined;

export function getClient(opts?: ApiClientOptions): ApiClient {
  if (opts?.apiUrl || opts?.token) {
    return new ApiClient(opts);
  }
  if (!defaultClient) {
    defaultClient = new ApiClient();
  }
  return defaultClient;
}

/** Reset the cached default client (useful when config changes) */
export function resetClient(): void {
  defaultClient = undefined;
}
