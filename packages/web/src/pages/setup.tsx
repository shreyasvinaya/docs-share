import { Link } from "react-router";
import { SetupChecklist } from "@/components/setup/setup-checklist";
import { PublicAuthAction } from "@/components/layout/public-auth-action";
import { PublicThemeControl } from "@/components/layout/public-theme-control";
import { useSetupStatus } from "@/hooks/use-setup";

export function SetupPage() {
  const { data: status, isLoading, isError } = useSetupStatus();
  const deploymentName = status?.deploymentName ?? "Docs Share";

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4">
          <Link to="/" className="font-semibold">
            {deploymentName}
          </Link>
          <nav className="flex items-center gap-2 text-sm">
            <Link
              to="/docs"
              className="rounded-lg px-3 py-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              Docs
            </Link>
            <PublicThemeControl />
            <PublicAuthAction />
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-5 py-10">
        <div className="mb-6">
          <p className="mb-2 text-sm font-medium uppercase text-muted-foreground">
            Deployment setup
          </p>
          <h1 className="text-3xl font-semibold">{deploymentName}</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
            Review the server configuration needed before inviting users or
            importing private repositories.
          </p>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading setup status...</p>
        ) : isError || !status ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            Could not load setup status.
          </p>
        ) : (
          <SetupChecklist status={status} />
        )}
      </section>
    </main>
  );
}
