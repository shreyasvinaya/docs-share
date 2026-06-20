import { isAbsolute, relative, resolve } from "path";
import { lookup as dnsLookup } from "dns/promises";

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
 * Returns true when `hostname` resolves to a loopback, link-local, private, or
 * otherwise non-routable address. Used to block SSRF against internal services
 * for user-controlled outbound webhook URLs. Handles IPv4, IPv6 (including
 * IPv4-mapped forms), and obvious internal hostnames.
 */
export function isPrivateOrLoopbackHost(hostname: string): boolean {
  if (!hostname) return true;

  let host = hostname.trim().toLowerCase();
  // Strip IPv6 brackets, e.g. "[::1]"
  if (host.startsWith("[") && host.endsWith("]")) {
    host = host.slice(1, -1);
  }

  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return true;
  }

  const ipv4 = parseIpv4(host);
  if (ipv4) return isPrivateIpv4(ipv4);

  if (host.includes(":")) {
    // IPv6. Handle IPv4-mapped addresses like ::ffff:127.0.0.1.
    const lastSegment = host.split(":").pop() ?? "";
    const mappedIpv4 = parseIpv4(lastSegment);
    if (mappedIpv4) return isPrivateIpv4(mappedIpv4);

    if (host === "::1" || host === "::") return true; // loopback / unspecified
    if (host.startsWith("fe80")) return true; // link-local
    if (host.startsWith("fc") || host.startsWith("fd")) return true; // unique local
    return false;
  }

  // Unresolved hostname (not an IP literal): allow — runtime fetch still goes
  // through the network and we cannot resolve here without a DNS dependency.
  return false;
}

function parseIpv4(value: string): [number, number, number, number] | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const num = Number(part);
    if (num > 255) return null;
    octets.push(num);
  }
  return octets as [number, number, number, number];
}

function isPrivateIpv4(octets: [number, number, number, number]): boolean {
  const [a, b] = octets;
  if (a === 0) return true; // 0.0.0.0/8 (this host)
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (CGNAT)
  if (a >= 224) return true; // multicast + reserved
  return false;
}

/**
 * Validates an outbound webhook URL. Requires an absolute http(s) URL and
 * rejects targets that point at internal/loopback/private hosts (SSRF guard).
 * Returns the normalized URL string when valid, otherwise null.
 */
export function validateWebhookUrl(input: string | null | undefined): string | null {
  if (!input) return null;

  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }
  if (parsed.username || parsed.password) return null;
  if (isPrivateOrLoopbackHost(parsed.hostname)) return null;

  return parsed.toString();
}

/** A resolved IP address with its address family (4 or 6). */
export interface ResolvedAddress {
  address: string;
  family: number;
}

/** Signature of a DNS resolver returning every address a hostname maps to. */
export type DnsLookupAll = (hostname: string) => Promise<ResolvedAddress[]>;

const defaultDnsLookupAll: DnsLookupAll = async (hostname) => {
  const results = await dnsLookup(hostname, { all: true });
  return results.map((r) => ({ address: r.address, family: r.family }));
};

/**
 * Resolves `hostname` via DNS and validates EVERY returned address against the
 * private/loopback/link-local guard. This is the anti-DNS-rebinding step for
 * outbound webhooks: a public hostname that resolves (even partially) to an
 * internal IP is rejected.
 *
 * Returns the list of resolved addresses when ALL are public/routable. Throws
 * when any address is private/loopback, or when resolution yields nothing.
 *
 * The resolver is injectable so callers (and tests) can pin or stub DNS. The
 * returned addresses should be used to PIN the subsequent connection so the
 * same IPs that were validated here are the ones actually connected to,
 * closing the validate-then-connect TOCTOU window.
 */
export async function resolveAndValidateHost(
  hostname: string,
  lookupAll: DnsLookupAll = defaultDnsLookupAll
): Promise<ResolvedAddress[]> {
  let host = hostname.trim();
  if (host.startsWith("[") && host.endsWith("]")) {
    host = host.slice(1, -1);
  }

  // IP literals skip DNS but are still validated directly.
  if (isPrivateOrLoopbackHost(host)) {
    throw new Error(`Host resolves to a non-routable address: ${hostname}`);
  }

  const ipv4 = parseIpv4(host);
  const isIpLiteral = ipv4 !== null || host.includes(":");
  if (isIpLiteral) {
    return [{ address: host, family: host.includes(":") ? 6 : 4 }];
  }

  const addresses = await lookupAll(host);
  if (!addresses.length) {
    throw new Error(`Host did not resolve to any address: ${hostname}`);
  }

  for (const { address } of addresses) {
    if (isPrivateOrLoopbackHost(address)) {
      throw new Error(
        `Host ${hostname} resolved to a non-routable address: ${address}`
      );
    }
  }

  return addresses;
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
