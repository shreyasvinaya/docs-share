import { describe, expect, test } from "bun:test";
import {
  MAX_FIELDS_PER_SUBMISSION,
  MAX_FIELD_VALUE_LENGTH,
  RateLimiter,
  clientIpFromHeaders,
  hashVisitor,
  isSiteDataTargetType,
  normalizeCollectionName,
  siteDataConnectSrc,
  validateSubmissionFields,
} from "./siteData.js";

describe("normalizeCollectionName", () => {
  test("accepts and lowercases safe slugs", () => {
    expect(normalizeCollectionName("Contact")).toBe("contact");
    expect(normalizeCollectionName("rsvp_2026")).toBe("rsvp_2026");
    expect(normalizeCollectionName("a-b-c")).toBe("a-b-c");
  });

  test("rejects empty, oversized, or unsafe names", () => {
    expect(normalizeCollectionName("")).toBeNull();
    expect(normalizeCollectionName("   ")).toBeNull();
    expect(normalizeCollectionName("a".repeat(65))).toBeNull();
    expect(normalizeCollectionName("-leading")).toBeNull();
    expect(normalizeCollectionName("has space")).toBeNull();
    expect(normalizeCollectionName("../etc")).toBeNull();
    expect(normalizeCollectionName("drop;table")).toBeNull();
    expect(normalizeCollectionName(42 as unknown)).toBeNull();
  });
});

describe("isSiteDataTargetType", () => {
  test("only allows draft or repo", () => {
    expect(isSiteDataTargetType("draft")).toBe(true);
    expect(isSiteDataTargetType("repo")).toBe(true);
    expect(isSiteDataTargetType("user")).toBe(false);
    expect(isSiteDataTargetType(null)).toBe(false);
  });
});

describe("validateSubmissionFields", () => {
  test("accepts a flat object of scalars", () => {
    const result = validateSubmissionFields({
      name: "Ada",
      age: 36,
      subscribed: true,
      note: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fields).toEqual({
        name: "Ada",
        age: 36,
        subscribed: true,
        note: null,
      });
    }
  });

  test("rejects non-object payloads", () => {
    expect(validateSubmissionFields(null).ok).toBe(false);
    expect(validateSubmissionFields("str").ok).toBe(false);
    expect(validateSubmissionFields([1, 2]).ok).toBe(false);
    expect(validateSubmissionFields(42).ok).toBe(false);
  });

  test("rejects empty submissions", () => {
    expect(validateSubmissionFields({}).ok).toBe(false);
  });

  test("rejects too many fields", () => {
    const big: Record<string, string> = {};
    for (let i = 0; i <= MAX_FIELDS_PER_SUBMISSION; i++) big[`f${i}`] = "x";
    expect(validateSubmissionFields(big).ok).toBe(false);
  });

  test("rejects nested objects and arrays as values", () => {
    expect(validateSubmissionFields({ a: { b: 1 } }).ok).toBe(false);
    expect(validateSubmissionFields({ a: [1] }).ok).toBe(false);
  });

  test("rejects non-finite numbers", () => {
    expect(validateSubmissionFields({ a: Infinity }).ok).toBe(false);
    expect(validateSubmissionFields({ a: NaN }).ok).toBe(false);
  });

  test("rejects oversized field values", () => {
    const result = validateSubmissionFields({
      a: "x".repeat(MAX_FIELD_VALUE_LENGTH + 1),
    });
    expect(result.ok).toBe(false);
  });

  test("rejects oversized total payloads", () => {
    const fields: Record<string, string> = {};
    for (let i = 0; i < 40; i++) fields[`field_${i}`] = "y".repeat(4900);
    expect(validateSubmissionFields(fields).ok).toBe(false);
  });
});

describe("hashVisitor", () => {
  test("is deterministic and never contains the raw IP", () => {
    const a = hashVisitor({ ip: "203.0.113.7", userAgent: "UA" }, "secret");
    const b = hashVisitor({ ip: "203.0.113.7", userAgent: "UA" }, "secret");
    expect(a).toBe(b);
    expect(a).not.toContain("203.0.113.7");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  test("differs for different visitors and secrets", () => {
    expect(
      hashVisitor({ ip: "1.1.1.1", userAgent: "UA" }, "s")
    ).not.toBe(hashVisitor({ ip: "2.2.2.2", userAgent: "UA" }, "s"));
    expect(
      hashVisitor({ ip: "1.1.1.1", userAgent: "UA" }, "s1")
    ).not.toBe(hashVisitor({ ip: "1.1.1.1", userAgent: "UA" }, "s2"));
  });
});

describe("clientIpFromHeaders", () => {
  test("prefers the first x-forwarded-for entry", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.7, 10.0.0.1",
    });
    expect(clientIpFromHeaders(headers)).toBe("203.0.113.7");
  });

  test("falls back to x-real-ip then null", () => {
    expect(
      clientIpFromHeaders(new Headers({ "x-real-ip": "198.51.100.2" }))
    ).toBe("198.51.100.2");
    expect(clientIpFromHeaders(new Headers())).toBeNull();
  });
});

describe("RateLimiter", () => {
  test("allows up to the limit then blocks within the window", () => {
    const limiter = new RateLimiter(3, 1000);
    expect(limiter.check("k", 0).allowed).toBe(true);
    expect(limiter.check("k", 100).allowed).toBe(true);
    expect(limiter.check("k", 200).allowed).toBe(true);
    expect(limiter.check("k", 300).allowed).toBe(false);
  });

  test("resets after the window elapses", () => {
    const limiter = new RateLimiter(1, 1000);
    expect(limiter.check("k", 0).allowed).toBe(true);
    expect(limiter.check("k", 500).allowed).toBe(false);
    expect(limiter.check("k", 1001).allowed).toBe(true);
  });

  test("tracks keys independently", () => {
    const limiter = new RateLimiter(1, 1000);
    expect(limiter.check("a", 0).allowed).toBe(true);
    expect(limiter.check("b", 0).allowed).toBe(true);
    expect(limiter.check("a", 0).allowed).toBe(false);
  });
});

describe("siteDataConnectSrc", () => {
  test("allows self and the API origin only, never a wildcard", () => {
    const directive = siteDataConnectSrc("http://localhost:3000");
    expect(directive).toBe("connect-src 'self' http://localhost:3000");
    expect(directive).not.toContain("*");
  });

  test("normalizes to the origin, dropping paths", () => {
    expect(siteDataConnectSrc("https://api.example.com/base/path")).toBe(
      "connect-src 'self' https://api.example.com"
    );
  });

  test("falls back to self when origin is unparseable", () => {
    expect(siteDataConnectSrc("not a url")).toBe("connect-src 'self'");
  });
});
