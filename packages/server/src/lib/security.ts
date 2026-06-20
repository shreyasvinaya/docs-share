import { isAbsolute, relative, resolve } from "path";
import { lookup as dnsLookup } from "dns/promises";
import { realpath } from "fs/promises";
import { homedir, tmpdir } from "os";
import ipaddr from "ipaddr.js";

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

  // NB: A leading `:` segment (which git would otherwise read as pathspec
  // "magic" like `:(glob)**` / `:(top)` / `:!`) is intentionally NOT rejected
  // here — `:notes.md` and `docs/:draft.md` are legitimate filenames. Pathspec
  // interpretation is neutralized at the git call sites instead, where every
  // user-path invocation forces `GIT_LITERAL_PATHSPECS=1` so a colon is always
  // treated as a literal character, never magic.
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
 * Returns true when `candidate` is lexically inside `base` (or equal to it).
 * Both are expected to be absolute, already-resolved paths.
 */
function isPathInside(base: string, candidate: string): boolean {
  const rel = relative(base, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Lexical containment (via {@link resolveInside}) PLUS symlink-aware
 * containment: after computing the in-base candidate path, the REAL path is
 * resolved with `fs.realpath` and verified to still live inside `baseDir`.
 *
 * This is the defense that {@link resolveInside} alone cannot provide: a symlink
 * materialized inside the worktree passes lexical containment yet points at an
 * absolute host path (e.g. `/etc/passwd`, the server `.env`, the SQLite DB, or
 * another tenant's worktree). Resolving the real path and re-checking closes
 * that escape.
 *
 * Non-existent leaf paths are handled gracefully: when the candidate itself does
 * not exist, the nearest existing ancestor is realpath-resolved instead, so a
 * legitimate 404 still reaches the caller (rather than being misclassified) and
 * a symlinked *ancestor* directory is still caught.
 *
 * Returns the real, contained absolute path, or null when the input is invalid
 * or the real path escapes the base directory.
 */
export async function resolveRealPathInside(
  baseDir: string,
  relativePath: string
): Promise<string | null> {
  const candidate = resolveInside(baseDir, relativePath);
  if (candidate === null) return null;

  // Resolve the base through symlinks too, so the containment comparison is
  // apples-to-apples (e.g. on macOS /var is itself a symlink to /private/var).
  const realBase = await realpath(resolve(baseDir)).catch(() => resolve(baseDir));

  // Walk up to the nearest existing path component so a not-yet-created leaf
  // doesn't defeat the check, while a symlinked ancestor is still resolved.
  let existing = candidate;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const real = await realpath(existing);
      if (!isPathInside(realBase, real)) return null;
      if (existing === candidate) {
        // Leaf itself exists: return its real (symlink-resolved) path.
        return real;
      }
      // An ancestor existed and is contained; project the remaining
      // (non-existent) suffix onto the ancestor's real path and re-check. A
      // non-existent leaf stays non-null (callers stat() it and 404), while an
      // escape via a symlinked ancestor is rejected.
      const suffix = relative(existing, candidate);
      const projected = resolve(real, suffix);
      return isPathInside(realBase, projected) ? projected : null;
    } catch {
      const parent = resolve(existing, "..");
      if (parent === existing) {
        // Reached the filesystem root without finding an existing path.
        return null;
      }
      existing = parent;
    }
  }
}

/** Strip surrounding IPv6 brackets, e.g. "[::1]" -> "::1". */
function stripBrackets(host: string): string {
  if (host.startsWith("[") && host.endsWith("]")) {
    return host.slice(1, -1);
  }
  return host;
}

// IPv4 ranges that must never be reached by an outbound webhook. ipaddr.js'
// `range()` classifies an IPv4 address into exactly one of these named ranges.
const BLOCKED_IPV4_RANGES = new Set([
  "unspecified", // 0.0.0.0/8
  "broadcast", // 255.255.255.255
  "private", // 10/8, 172.16/12, 192.168/16
  "carrierGradeNat", // 100.64/10
  "loopback", // 127/8
  "linkLocal", // 169.254/16
  "multicast", // 224/4
  "reserved", // 240/4 and other reserved blocks
  "benchmarking", // 198.18/15
  "as112", // 192.175.48/24
]);

// IPv6 ranges that must never be reached. Note: an IPv4-mapped/translated IPv6
// (ipv4Mapped, rfc6145, rfc6052, 6to4, teredo) is decoded to its embedded IPv4
// and re-checked against BLOCKED_IPV4_RANGES rather than being judged here, so
// "::ffff:7f00:1" (== ::ffff:127.0.0.1) is correctly blocked.
const BLOCKED_IPV6_RANGES = new Set([
  "unspecified", // ::
  "linkLocal", // fe80::/10
  "multicast", // ff00::/8
  "loopback", // ::1
  "uniqueLocal", // fc00::/7 (fc.. / fd..)
  "reserved", // various reserved
  "benchmarking", // 2001:2::/48
  "as112v6", // 2001:4:112::/48
  "orchid2", // 2001:20::/28
]);

/**
 * Returns true when `ip` is a parsed IP literal pointing at a loopback,
 * link-local, private, unique-local, CGNAT, multicast, reserved, or otherwise
 * non-routable address. IPv4-mapped / translated IPv6 forms are decoded to the
 * embedded IPv4 and re-checked, so both the dotted (`::ffff:127.0.0.1`) and the
 * hex-compressed (`::ffff:7f00:1`) IPv4-mapped representations are caught.
 */
function isBlockedIpAddress(ip: ipaddr.IPv4 | ipaddr.IPv6): boolean {
  if (ip.kind() === "ipv4") {
    return BLOCKED_IPV4_RANGES.has(ip.range());
  }

  const ipv6 = ip as ipaddr.IPv6;
  const range = ipv6.range();

  // IPv4-mapped (::ffff:a.b.c.d / ::ffff:7f00:1). Decode and re-check as IPv4.
  if (ipv6.isIPv4MappedAddress()) {
    return BLOCKED_IPV4_RANGES.has(ipv6.toIPv4Address().range());
  }

  // Other IPv6-embedded-IPv4 transition mechanisms — decode the embedded v4 and
  // block if it is non-routable.
  if (range === "rfc6145" || range === "rfc6052" || range === "6to4" || range === "teredo") {
    try {
      return BLOCKED_IPV4_RANGES.has(ipv6.toIPv4Address().range());
    } catch {
      // Some of these ranges are not always convertible; fall back to blocking
      // the transition range outright to stay safe.
      return true;
    }
  }

  return BLOCKED_IPV6_RANGES.has(range);
}

/**
 * Parse `host` as an IP literal (IPv4 or IPv6, brackets already stripped) and
 * return the parsed address, or null when it is not an IP literal (i.e. it is a
 * DNS hostname). Uses ipaddr.js so every representation — dotted, hex,
 * compressed, expanded, and IPv4-mapped — is handled uniformly.
 */
function parseIpLiteral(host: string): ipaddr.IPv4 | ipaddr.IPv6 | null {
  if (!ipaddr.isValid(host)) return null;
  try {
    return ipaddr.parse(host);
  } catch {
    return null;
  }
}

/**
 * Returns true when `hostname` is a loopback, link-local, private, unique-local,
 * CGNAT, multicast, reserved, or otherwise non-routable address. Used to block
 * SSRF against internal services for user-controlled outbound webhook URLs.
 *
 * IP literals are parsed with ipaddr.js and classified by range, covering IPv4,
 * IPv6, expanded/compressed forms, and IPv4-mapped IPv6 in BOTH dotted
 * (`::ffff:127.0.0.1`) and hex-compressed (`::ffff:7f00:1`) representations —
 * the latter is what Node/Bun normalize a bracketed IPv6 host into, so it must
 * be blocked too. Obvious internal hostnames are matched by suffix.
 */
export function isPrivateOrLoopbackHost(hostname: string): boolean {
  if (!hostname) return true;

  const host = stripBrackets(hostname.trim().toLowerCase());

  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return true;
  }

  const ip = parseIpLiteral(host);
  if (ip) return isBlockedIpAddress(ip);

  // Unresolved hostname (not an IP literal): allow here — the DNS-resolution
  // step (resolveAndValidateHost) is responsible for validating every address
  // the name actually resolves to.
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
  const host = stripBrackets(hostname.trim());

  // IP literals skip DNS but are still validated directly.
  if (isPrivateOrLoopbackHost(host)) {
    throw new Error(`Host resolves to a non-routable address: ${hostname}`);
  }

  const ip = parseIpLiteral(host);
  if (ip) {
    return [{ address: host, family: ip.kind() === "ipv6" ? 6 : 4 }];
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

/** Escape a string for safe inclusion in a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Strip absolute filesystem paths from a string that is about to be returned to
 * a client. Raw git/process stderr routinely embeds server-internal paths (the
 * configured DATA_DIR, the OS temp dir where clones land, the home dir), which
 * leak the host's directory layout. This replaces those prefixes — and any
 * remaining bare absolute paths — with a `[path]` placeholder.
 *
 * Server-side logging should keep the full detail; only client-facing strings
 * should pass through this. The base directories default to the runtime
 * DATA_DIR (via env), the OS temp dir, and the home dir, but are injectable for
 * tests.
 */
export function redactInternalPaths(
  output: string,
  baseDirs: string[] = [
    resolve(process.env.DATA_DIR ?? "./data"),
    tmpdir(),
    homedir(),
  ]
): string {
  let result = output;

  // Replace known internal base dirs (longest first so nested matches win).
  // Each match also greedily consumes any trailing path component, so a full
  // path like `${DATA_DIR}/worktrees/repo123/x` collapses to a single `[path]`
  // (not `[path]/worktrees/repo123/x`).
  const dirs = [...new Set(baseDirs.filter(Boolean).map((d) => resolve(d)))].sort(
    (a, b) => b.length - a.length
  );
  for (const dir of dirs) {
    result = result.replace(
      new RegExp(`${escapeRegExp(dir)}(?:/[\\w.@%+-]+)*`, "g"),
      "[path]"
    );
  }

  // Catch any remaining absolute-looking POSIX paths (e.g. a stray /var/... or
  // /private/tmp/... not covered above). The leading slash MUST sit at a
  // boundary — start-of-string, whitespace, a quote, `=`, `(`, or the `]` that
  // closes a `[path]` placeholder — so the path component of a URL (e.g.
  // `https://github.com/a/b`) is NOT eaten: there the slash is preceded by `:`
  // (from `://`) or another path char, never a boundary. Matches at least one
  // path segment containing a slash, so ordinary text like "/" or sentences are
  // left alone.
  result = result.replace(
    /(^|[\s'"=`(\]])(\/(?:[\w.@%+-]+\/)+[\w.@%+-]*)/g,
    (_match, boundary: string) => `${boundary}[path]`
  );

  return result;
}
