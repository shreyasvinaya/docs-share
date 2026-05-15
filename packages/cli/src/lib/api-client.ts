import { getToken, getApiUrl } from "./config.js";
import {
  CliError,
  AuthError,
  NetworkError,
  NotFoundError,
  PermissionDeniedError,
  EXIT_CODES,
} from "./errors.js";

export interface ApiClientOptions {
  apiUrl?: string;
  token?: string;
}

export class ApiClient {
  private baseUrl: string;
  private token: string;

  constructor(opts: ApiClientOptions = {}) {
    this.baseUrl = (opts.apiUrl ?? getApiUrl()).replace(/\/+$/, "");
    this.token = opts.token ?? getToken();
  }

  private async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    options?: { formData?: FormData }
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
    };

    let fetchBody: BodyInit | undefined;

    if (options?.formData) {
      fetchBody = options.formData;
      // Do not set Content-Type — fetch will add multipart boundary automatically
    } else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      fetchBody = JSON.stringify(body);
    }

    let res: Response;
    try {
      res = await fetch(url, { method, headers, body: fetchBody });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown network error";
      throw new NetworkError(`Failed to connect to ${this.baseUrl}: ${message}`);
    }

    if (res.ok) {
      const text = await res.text();
      if (!text) return undefined as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        return text as T;
      }
    }

    // Handle error responses
    let errorBody: { error?: string; details?: unknown } = {};
    try {
      errorBody = await res.json();
    } catch {
      // Response body may not be JSON
    }

    const errorMessage = errorBody.error ?? `HTTP ${res.status}: ${res.statusText}`;

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
