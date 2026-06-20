import { createHmac } from "crypto";

/**
 * Site-data collection lets hosted docs (drafts / repos) collect form
 * submissions back into Patra via a public, unauthenticated ingestion
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

// Conservative field-key charset: must start alphanumeric, then alphanumerics
// plus `_ . -`, up to MAX_FIELD_KEY_LENGTH. This rejects control/bidi chars,
// whitespace, and other surprises in a public, attacker-controlled payload.
const FIELD_KEY_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;

// Keys that could pollute Object.prototype if assigned onto a plain object.
const FORBIDDEN_FIELD_KEYS = new Set(["__proto__", "prototype", "constructor"]);

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

  // Assign only own, fully-validated keys. Prototype-pollution keys are
  // rejected outright below, and the key regex forbids any character outside
  // `[a-zA-Z0-9_.-]`, so no special key (e.g. "__proto__") can ever be written
  // onto the result and reach Object.prototype.
  const fields: SiteDataFields = {};
  for (const [key, value] of entries) {
    if (!key || key.length > MAX_FIELD_KEY_LENGTH) {
      return { ok: false, error: "Field names must be 1-128 characters" };
    }
    if (FORBIDDEN_FIELD_KEYS.has(key)) {
      return { ok: false, error: `Field name "${key}" is not allowed` };
    }
    if (!FIELD_KEY_RE.test(key)) {
      return {
        ok: false,
        error: `Field name "${key}" contains invalid characters`,
      };
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

/** Default hard cap on distinct buckets a single RateLimiter may hold. */
export const DEFAULT_RATE_LIMITER_MAX_ENTRIES = 10000;

/**
 * Tiny fixed-window in-memory rate limiter. Self-hosted single-process
 * deployments don't need a distributed limiter; this caps abusive bursts to
 * the public ingestion endpoint without external dependencies.
 *
 * The bucket store is bounded two ways so a flood of distinct keys (e.g. many
 * client IPs / visitor hashes) cannot exhaust memory, mirroring
 * {@link ../middleware/rateLimit.ts}:
 *   1. Expired buckets are reclaimed lazily on each {@link check} (the key being
 *      touched) and via an amortised periodic sweep across the whole store.
 *   2. A hard `maxEntries` cap evicts expired-or-oldest buckets when exceeded.
 *      The Map preserves insertion order, so the oldest keys are evicted first.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  // Amortised periodic sweep: every Nth check we walk the store once and drop
  // every expired bucket. Cheap, allocation-free, and needs no timers.
  private static readonly SWEEP_EVERY_CHECKS = 1000;
  private checksSinceSweep = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxEntries: number = DEFAULT_RATE_LIMITER_MAX_ENTRIES
  ) {}

  check(key: string, now: number = Date.now()): RateLimitResult {
    // Amortised store-wide sweep so abandoned buckets don't accumulate even when
    // their own key is never checked again.
    if (++this.checksSinceSweep >= RateLimiter.SWEEP_EVERY_CHECKS) {
      this.checksSinceSweep = 0;
      this.prune(now);
    }

    const existing = this.hits.get(key);
    if (!existing || existing.resetAt <= now) {
      // Delete-then-set so the (possibly expired) bucket moves to the back of
      // the Map's insertion order, keeping eviction oldest-first (LRU-ish).
      this.hits.delete(key);
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      this.enforceMaxEntries(now);
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

  /**
   * Enforce the hard entry cap: reclaim expired buckets first, then evict the
   * oldest live buckets until the store is back within `maxEntries`.
   */
  private enforceMaxEntries(now: number): void {
    if (this.hits.size <= this.maxEntries) return;
    this.prune(now);
    for (const key of this.hits.keys()) {
      if (this.hits.size <= this.maxEntries) break;
      this.hits.delete(key);
    }
  }

  /** Test-only: current number of live+expired buckets held in memory. */
  size(): number {
    return this.hits.size;
  }

  reset(): void {
    this.hits.clear();
    this.checksSinceSweep = 0;
  }
}

/**
 * Build the `connect-src` CSP directive value that lets a sandboxed hosted page
 * POST form submissions to the ingestion endpoint. We allow ONLY the API
 * origin (plus 'self'), never a wildcard, so a compromised page can exfiltrate
 * to Patra's own endpoint but not to arbitrary attacker servers.
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
