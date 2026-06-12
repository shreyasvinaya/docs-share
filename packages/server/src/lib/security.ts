import { isAbsolute, relative, resolve } from "path";

const INSECURE_SECRET_VALUES = new Set([
  "dev-secret-change-in-production",
  "dev-hook-secret-change-in-production",
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
  if (input.includes("\0")) return null;

  const normalized = input.replaceAll("\\", "/");
  if (normalized.startsWith("/")) return null;

  const segments = normalized.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
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
