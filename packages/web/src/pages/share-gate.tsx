import { useEffect } from "react";
import { useSearchParams } from "react-router";
import { useOptionalSession } from "@/hooks/use-auth";
import { resolveShareGateView } from "@/lib/share-gate";
import { buildLoginHref, safeClientNext } from "@/lib/next-url";

export function ShareGatePage() {
  const [params] = useSearchParams();
  const next = params.get("next");
  const safeNext = safeClientNext(next);
  const domain = params.get("domain");
  const { data, isLoading } = useOptionalSession();

  const view = resolveShareGateView(domain, {
    isLoading,
    email: data?.user.email ?? null,
  });

  // Auto-redirect through the open-redirect guard; fall back to /app when next
  // is missing or unsafe (avoids a dead-end "Loading…" screen and blocks
  // /share-gate?next=https://evil.com style open redirects on this public route).
  useEffect(() => {
    if (view.kind === "allowed") {
      window.location.replace(safeNext ?? "/app");
    }
  }, [view.kind, safeNext]);

  async function handleSwitchAccount() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    window.location.assign(buildLoginHref(next));
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-sm">
        <div className="rounded-xl border border-border bg-background p-8 text-center shadow-sm">
          {view.kind === "loading" || view.kind === "allowed" ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : view.kind === "sign-in" ? (
            <>
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 0h10.5a2.25 2.25 0 012.25 2.25v6.75a2.25 2.25 0 01-2.25 2.25H6.75a2.25 2.25 0 01-2.25-2.25v-6.75a2.25 2.25 0 012.25-2.25z" />
                </svg>
              </div>
              <h1 className="text-lg font-bold">Restricted document</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                This link is restricted to{" "}
                <span className="font-medium text-foreground">@{view.domain}</span>{" "}
                members. Sign in to continue.
              </p>
              <a
                href={buildLoginHref(next)}
                className="mt-6 inline-flex w-full items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Sign in to continue
              </a>
            </>
          ) : (
            <>
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
              </div>
              <h1 className="text-lg font-bold">Access restricted</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                This link is limited to{" "}
                <span className="font-medium text-foreground">@{view.domain}</span>{" "}
                members. You're signed in as{" "}
                <span className="font-medium text-foreground">{view.email}</span>.
              </p>
              <button
                type="button"
                onClick={handleSwitchAccount}
                className="mt-6 inline-flex w-full items-center justify-center rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
              >
                Sign out &amp; switch account
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
