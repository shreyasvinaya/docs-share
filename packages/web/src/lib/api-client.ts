import type { ApiError } from "@patra/shared";

class ApiClientError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const isFormData = options.body instanceof FormData;
  const res = await fetch(path, {
    ...options,
    credentials: "include",
    headers: isFormData
      ? {}
      : {
          "Content-Type": "application/json",
          ...options.headers,
        },
  });

  if (!res.ok) {
    if (res.status === 401) {
      window.location.href = "/login";
      throw new ApiClientError("Unauthorized", 401);
    }
    const body = (await res.json().catch(() => ({
      error: res.statusText,
    }))) as ApiError;
    throw new ApiClientError(body.error, res.status);
  }

  if (res.status === 204) return undefined as T;
  const json = await res.json();
  // Server wraps responses in { data: ... } — unwrap automatically
  if (json && typeof json === "object" && "data" in json) {
    return json.data as T;
  }
  return json as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "PUT",
      body: body ? JSON.stringify(body) : undefined,
    }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: "PATCH",
      body: body ? JSON.stringify(body) : undefined,
    }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  upload: <T>(path: string, formData: FormData) =>
    request<T>(path, {
      method: "POST",
      body: formData,
      headers: {},
    }),
};

export { ApiClientError };
