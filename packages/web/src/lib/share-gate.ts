export type ShareGateView =
  | { kind: "loading" }
  | { kind: "sign-in"; domain: string }
  | { kind: "wrong-domain"; domain: string; email: string }
  | { kind: "allowed" };

/**
 * Decide what the share-gate page should render given the org `domain` the
 * link is restricted to (from the query string) and the current session.
 * Domain comparison is case-insensitive to match the server gate and avoid a
 * gate-versus-server redirect loop.
 */
export function resolveShareGateView(
  domain: string | null,
  session: { isLoading: boolean; email: string | null }
): ShareGateView {
  if (session.isLoading) return { kind: "loading" };
  if (!domain) return { kind: "allowed" };
  if (!session.email) return { kind: "sign-in", domain };
  const userDomain = session.email.split("@")[1] ?? "";
  if (userDomain.toLowerCase() !== domain.toLowerCase()) {
    return { kind: "wrong-domain", domain, email: session.email };
  }
  return { kind: "allowed" };
}
