/**
 * Returns `raw` only when it is a safe same-origin path. Defense-in-depth on
 * the client; the server's safeNextPath is the authoritative guard. Mirrors
 * packages/server/src/lib/security.ts:safeNextPath.
 */
export function safeClientNext(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw[0] !== "/") return null;
  if (raw[1] === "/") return null;
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code < 32 || code === 127 || code === 92) return null; // control char, DEL, or backslash
  }
  return raw;
}

/** Login URL that returns to `next` after authentication. */
export function buildLoginHref(next: string | null | undefined): string {
  const safe = safeClientNext(next);
  return safe ? `/login?next=${encodeURIComponent(safe)}` : "/login";
}

/** Google OAuth start URL, forwarding `next` for post-login return. */
export function buildGoogleAuthHref(next: string | null | undefined): string {
  const safe = safeClientNext(next);
  return safe
    ? `/api/auth/google?next=${encodeURIComponent(safe)}`
    : "/api/auth/google";
}
