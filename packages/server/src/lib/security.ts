import { isAbsolute, relative, resolve } from "path";

const INSECURE_SECRET_VALUES = new Set([
  "dev-secret-change-in-production",
  "dev-hook-secret-change-in-production",
  "dev-draft-content-secret-change-in-production",
  "dev-github-token-secret-change-in-production",
  "change-this-to-a-random-string",
  "",
]);

export function isProduction(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "production" || env.APP_ENV === "production";
}

export function assertProductionSecret(
  name: string,
  value: string,
  env: NodeJS.ProcessEnv = process.env
): void {
  if (!isProduction(env)) return;

  if (INSECURE_SECRET_VALUES.has(value) || value.length < 32) {
    throw new Error(
      `${name} must be set to a non-default value with at least 32 characters in production`
    );
  }
}

export function normalizeRelativePath(input: string | null | undefined): string | null {
  if (!input) return "";

  // Reject NUL and any other control character (incl. DEL). These have no
  // legitimate place in a repo path and can confuse downstream tooling.
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code < 32 || code === 127) return null;
  }

  const normalized = input.replaceAll("\\", "/");
  if (normalized.startsWith("/")) return null;

  const segments = normalized.split("/").filter(Boolean);
  if (
    segments.some(
      (segment) =>
        segment === "." ||
        segment === ".." ||
        // Block any `.git` segment (case-insensitive) to keep callers away from
        // git internals regardless of where it appears in the path.
        segment.toLowerCase() === ".git"
    )
  ) {
    return null;
  }

  return segments.join("/");
}

export function resolveInside(baseDir: string, relativePath: string): string | null {
  const normalizedPath = normalizeRelativePath(relativePath);
  if (normalizedPath === null) return null;

  const base = resolve(baseDir);
  const target = resolve(base, normalizedPath);
  const rel = relative(base, target);

  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    return target;
  }

  return null;
}

/**
 * Returns `next` only when it is a safe, same-origin path suitable as a
 * post-login redirect target. Guards against open redirects: rejects absolute
 * URLs, protocol-relative ("//host"), backslash-containing paths, and control
 * characters. Returns null when `next` is missing or unsafe.
 */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next) return null;
  if (next[0] !== "/") return null; // must be root-relative
  if (next[1] === "/") return null; // reject protocol-relative //host
  for (let i = 0; i < next.length; i++) {
    const code = next.charCodeAt(i);
    if (code < 32 || code === 127 || code === 92) return null; // control char, DEL, or backslash
  }
  return next;
}
