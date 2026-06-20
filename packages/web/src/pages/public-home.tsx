import { Link } from "react-router";
import { PublicAuthAction } from "@/components/layout/public-auth-action";
import { PublicThemeControl } from "@/components/layout/public-theme-control";
import { useDeploymentName } from "@/hooks/use-setup";
import heroImage from "../../../../docs/assets/patra-readme-hero.png?url";
import workflowImage from "../../../../docs/assets/patra-workflow.png?url";

const workflows = [
  {
    title: "Publish a draft from an agent",
    body: "Upload one HTML file with an API token and get a clean authenticated URL back for review.",
  },
  {
    title: "Share static docs with people",
    body: "Keep personal and team spaces separate, then grant user, team, or link access from the preview.",
  },
  {
    title: "Preserve full static sites",
    body: "Upload linked HTML, CSS, images, and folders without breaking relative asset paths.",
  },
];

const capabilities = [
  "Authenticated draft URLs with a minimal hosted viewer",
  "Personal and team repositories backed by local Git storage",
  "Preview, update, delete, and share flows for uploaded files",
  "CLI commands for agents and local automation",
  "Self-hostable deployment with SQLite and filesystem storage",
  "Separate content-origin guidance for untrusted HTML",
];

export function PublicHomePage() {
  const deploymentName = useDeploymentName();

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0f766e] text-[#fef3c7]">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 20c4.5-3.1 7-7.2 7-11.1 0-2.7-2-5.4-7-6.9-5 1.5-7 4.2-7 6.9C5 12.8 7.5 16.9 12 20Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.5v10M9 9.5c1 .7 2 1 3 1s2-.3 3-1M8.6 13c1.1.8 2.2 1.2 3.4 1.2s2.3-.4 3.4-1.2" />
              </svg>
            </span>
            {deploymentName}
          </Link>
          <nav className="flex items-center gap-2 text-sm">
            <Link to="/docs" className="rounded-lg px-3 py-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              Docs
            </Link>
            <PublicThemeControl />
            <PublicAuthAction />
          </nav>
        </div>
      </header>

      <section className="overflow-hidden border-b border-border bg-[radial-gradient(circle_at_top_left,rgba(20,184,166,0.16),transparent_34%),linear-gradient(180deg,rgba(248,246,240,0.82),transparent)] dark:bg-[radial-gradient(circle_at_top_left,rgba(20,184,166,0.18),transparent_34%),linear-gradient(180deg,rgba(20,33,31,0.52),transparent)]">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 lg:grid-cols-[0.88fr_1.12fr] lg:items-center">
          <div>
            <p className="mb-4 text-sm font-semibold uppercase tracking-[0.18em] text-[#0f766e] dark:text-[#5eead4]">
              Git-backed document publishing
            </p>
            <h1 className="max-w-3xl text-4xl font-semibold leading-tight sm:text-5xl">
              Publish generated docs and static sites into links people can actually review.
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
              {deploymentName} turns agent-generated plans, reports, dashboards, and prototypes into signed-in previews with team sharing, Git history, scoped tokens, and self-hosted control.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <PublicAuthAction
                className="bg-[#0f766e] px-5 py-3 text-sm text-white hover:bg-[#115e59]"
                signedInLabel="Open workspace"
              />
              <Link to="/docs" className="rounded-lg border border-border bg-background/80 px-5 py-3 text-sm font-medium transition-colors hover:bg-muted">
                Read docs
              </Link>
            </div>
            <dl className="mt-9 grid max-w-xl grid-cols-3 gap-3 text-sm">
              <div className="rounded-lg border border-border bg-background/75 p-3">
                <dt className="font-semibold text-foreground">CLI-first</dt>
                <dd className="mt-1 text-muted-foreground">agent handoffs</dd>
              </div>
              <div className="rounded-lg border border-border bg-background/75 p-3">
                <dt className="font-semibold text-foreground">Git-backed</dt>
                <dd className="mt-1 text-muted-foreground">versioned files</dd>
              </div>
              <div className="rounded-lg border border-border bg-background/75 p-3">
                <dt className="font-semibold text-foreground">Scoped</dt>
                <dd className="mt-1 text-muted-foreground">share access</dd>
              </div>
            </dl>
          </div>

          <div className="relative">
            <img
              src={heroImage}
              alt="Illustration of Patra publishing, sharing, versioning, and securing documents"
              className="aspect-[16/9] w-full rounded-lg border border-border object-cover shadow-2xl shadow-teal-950/10"
            />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-14">
        <div className="grid gap-4 md:grid-cols-3">
          {workflows.map((item) => (
            <article key={item.title} className="rounded-lg border border-border p-5">
              <h2 className="text-base font-semibold">{item.title}</h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-y border-border bg-muted/35">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-14 lg:grid-cols-[420px_1fr] lg:items-center">
          <div>
            <img
              src={workflowImage}
              alt="Illustration of an agent publishing an HTML draft through Git-backed storage into a secure preview link"
              className="mb-6 aspect-[16/9] w-full rounded-lg border border-border object-cover"
            />
            <h2 className="text-2xl font-semibold">Built for agent handoffs and human review.</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              The platform keeps the publishing loop small: create HTML, upload it, share the preview, then update or remove it when the work changes.
            </p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {capabilities.map((capability) => (
              <li key={capability} className="flex gap-3 rounded-lg border border-border bg-background p-4 text-sm">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-foreground" />
                <span>{capability}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-14">
        <div className="rounded-lg border border-border p-6">
          <h2 className="text-2xl font-semibold">Agent-friendly publishing</h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
            Use the CLI from scripts, local agents, or CI jobs. The draft command prints one URL by default, while the broader push command preserves multi-file static sites.
          </p>
          <pre className="mt-5 overflow-x-auto rounded-lg bg-foreground p-4 text-sm text-background"><code>{`patra login --token pat_...
patra draft ./plan.html
patra push ./site --to personal --message "Publish linked draft"`}</code></pre>
        </div>
      </section>
    </main>
  );
}
