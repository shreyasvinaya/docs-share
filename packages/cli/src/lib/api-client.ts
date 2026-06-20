import {
  getToken,
  getApiUrl,
  validateApiUrl,
  getTimeoutMs,
  getUploadTimeoutMs,
  getMaxRetries,
  getRetryBaseMs,
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
}

/** HTTP status codes worth retrying for idempotent requests. */
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

/** Cap any honored Retry-After / backoff delay so we never hang for minutes. */
const MAX_BACKOFF_MS = 30_000;

function isLocalhost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "::1" ||
    h === "[::1]" ||
    h.endsWith(".localhost")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse a Retry-After header value into milliseconds. Supports both the
 * delta-seconds form ("120") and the HTTP-date form. Returns undefined when
 * absent or unparseable.
 */
function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const date = Date.parse(value);
  if (!Number.isNaN(date)) {
    return Math.max(0, date - Date.now());
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
        throw new NetworkError(`request to ${url} timed out after ${secs}`);
      }
      const message =
        err instanceof Error ? err.message : "Unknown network error";
      throw new NetworkError(`Failed to connect to ${this.baseUrl}: ${message}`);
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
          `Refusing to follow redirect from ${url}` +
            (location ? ` to ${location}` : "") +
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

  private async parseSuccess<T>(res: Response): Promise<T> {
    const text = await res.text();
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
      errorBody = await res.json();
    } catch {
      // Response body may not be JSON
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
