import { createHmac } from "crypto";

/**
 * Site-data collection lets hosted docs (drafts / repos) collect form
 * submissions back into docs-share via a public, unauthenticated ingestion
 * endpoint. Because the endpoint accepts writes from sandboxed third-party
 * pages, every helper here is deliberately conservative: strict shape/size
 * validation, spam/rate limiting, and only hashed visitor identifiers are
 * stored (never the raw IP/PII beyond the fields the form itself submits).
 */

export const SITE_DATA_TARGET_TYPES = ["draft", "repo"] as const;
export type SiteDataTargetType = (typeof SITE_DATA_TARGET_TYPES)[number];

// Field/shape limits — keep these tight; the endpoint is public.
export const MAX_COLLECTION_NAME_LENGTH = 64;
export const MAX_FIELDS_PER_SUBMISSION = 50;
export const MAX_FIELD_KEY_LENGTH = 128;
export const MAX_FIELD_VALUE_LENGTH = 5000;
export const MAX_SUBMISSION_BYTES = 64 * 1024; // 64 KB serialized payload cap

// A submitted field value: scalars only. No nested objects/arrays — keeps the
// stored JSON flat, predictable, and cheap to validate.
export type SiteDataFieldValue = string | number | boolean | null;
export type SiteDataFields = Record<string, SiteDataFieldValue>;

export interface SiteDataValidationOk {
  ok: true;
  fields: SiteDataFields;
}
export interface SiteDataValidationError {
  ok: false;
  error: string;
}
export type SiteDataValidation = SiteDataValidationOk | SiteDataValidationError;

const COLLECTION_NAME_RE = /^[a-z0-9][a-z0-9_-]*$/i;

/**
 * Validate a collection name. Collections are an unprivileged, free-form label
 * chosen by the page author (e.g. "contact", "rsvp"). Restrict to a safe slug
 * charset so it can be stored/queried/displayed without escaping surprises.
 */
export function normalizeCollectionName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > MAX_COLLECTION_NAME_LENGTH) return null;
  if (!COLLECTION_NAME_RE.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

export function isSiteDataTargetType(
  value: unknown
): value is SiteDataTargetType {
  return (
    typeof value === "string" &&
    (SITE_DATA_TARGET_TYPES as readonly string[]).includes(value)
  );
}

function isPlainScalar(value: unknown): value is SiteDataFieldValue {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

/**
 * Validate a submitted fields payload. Enforces:
 *  - object shape (no arrays / primitives at the top level)
 *  - field count cap
 *  - key charset/length
 *  - scalar-only values with a per-value length cap
 *  - total serialized size cap
 */
export function validateSubmissionFields(input: unknown): SiteDataValidation {
  if (
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input)
  ) {
    return { ok: false, error: "Submission must be a JSON object of fields" };
  }

  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length === 0) {
    return { ok: false, error: "Submission must include at least one field" };
  }
  if (entries.length > MAX_FIELDS_PER_SUBMISSION) {
    return {
      ok: false,
      error: `Submission exceeds the ${MAX_FIELDS_PER_SUBMISSION}-field limit`,
    };
  }

  const fields: SiteDataFields = {};
  for (const [key, value] of entries) {
    if (!key || key.length > MAX_FIELD_KEY_LENGTH) {
      return { ok: false, error: "Field names must be 1-128 characters" };
    }
    if (!isPlainScalar(value)) {
      return {
        ok: false,
        error: `Field "${key}" must be a string, number, boolean, or null`,
      };
    }
    if (typeof value === "string" && value.length > MAX_FIELD_VALUE_LENGTH) {
      return {
        ok: false,
        error: `Field "${key}" exceeds the ${MAX_FIELD_VALUE_LENGTH}-character limit`,
      };
    }
    fields[key] = value;
  }

  if (Buffer.byteLength(JSON.stringify(fields), "utf8") > MAX_SUBMISSION_BYTES) {
    return { ok: false, error: "Submission payload is too large" };
  }

  return { ok: true, fields };
}

/**
 * Hash a visitor identifier (IP + user-agent) with the server secret so the
 * stored value cannot be reversed to a raw IP but is still stable enough to
 * support per-visitor rate limiting and abuse triage. Never store the raw IP.
 */
export function hashVisitor(
  parts: { ip: string | null; userAgent: string | null },
  secret: string
): string {
  const material = `${parts.ip ?? ""}|${parts.userAgent ?? ""}`;
  return createHmac("sha256", secret).update(material).digest("hex");
}

/**
 * Best-effort client IP extraction from proxy headers. Returns null when no
 * trustworthy value is present; callers must treat null gracefully.
 */
export function clientIpFromHeaders(
  headers: { get(name: string): string | null }
): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = headers.get("x-real-ip");
  if (real?.trim()) return real.trim();
  return null;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

/**
 * Tiny fixed-window in-memory rate limiter. Self-hosted single-process
 * deployments don't need a distributed limiter; this caps abusive bursts to
 * the public ingestion endpoint without external dependencies.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number
  ) {}

  check(key: string, now: number = Date.now()): RateLimitResult {
    const existing = this.hits.get(key);
    if (!existing || existing.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, remaining: this.limit - 1 };
    }
    if (existing.count >= this.limit) {
      return { allowed: false, remaining: 0 };
    }
    existing.count += 1;
    return { allowed: true, remaining: this.limit - existing.count };
  }

  /** Drop expired buckets to bound memory. Called opportunistically. */
  prune(now: number = Date.now()): void {
    for (const [key, bucket] of this.hits) {
      if (bucket.resetAt <= now) this.hits.delete(key);
    }
  }

  reset(): void {
    this.hits.clear();
  }
}

/**
 * Build the `connect-src` CSP directive value that lets a sandboxed hosted page
 * POST form submissions to the ingestion endpoint. We allow ONLY the API
 * origin (plus 'self'), never a wildcard, so a compromised page can exfiltrate
 * to docs-share's own endpoint but not to arbitrary attacker servers.
 */
export function siteDataConnectSrc(apiOrigin: string): string {
  const origin = normalizeOrigin(apiOrigin);
  const sources = ["'self'"];
  if (origin && origin !== "'self'") sources.push(origin);
  return `connect-src ${sources.join(" ")}`;
}

function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return url.origin;
  } catch {
    return null;
  }
}
