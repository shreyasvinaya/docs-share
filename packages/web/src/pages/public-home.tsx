import { Link } from "react-router";

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
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
            </span>
            docs-share
          </Link>
          <nav className="flex items-center gap-2 text-sm">
            <Link to="/docs" className="rounded-lg px-3 py-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              Docs
            </Link>
            <Link to="/login" className="rounded-lg px-3 py-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              Sign in
            </Link>
            <Link to="/app" className="rounded-lg bg-primary px-3 py-2 font-medium text-primary-foreground transition-colors hover:bg-primary/90">
              Open app
            </Link>
          </nav>
        </div>
      </header>

      <section className="border-b border-border">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 lg:grid-cols-[1fr_420px] lg:items-center">
          <div>
            <p className="mb-4 text-sm font-medium uppercase text-muted-foreground">
              Authenticated static HTML draft publishing
            </p>
            <h1 className="max-w-3xl text-4xl font-semibold leading-tight sm:text-5xl">
              Give coding agents a private place to publish the HTML they want you to inspect.
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
              docs-share turns agent-generated plans, reports, dashboards, and static prototypes into signed-in preview links with team sharing, versioned storage, and CLI-first publishing.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/app" className="rounded-lg bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
                Open workspace
              </Link>
              <Link to="/docs" className="rounded-lg border border-border px-5 py-3 text-sm font-medium transition-colors hover:bg-muted">
                Read docs
              </Link>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-muted/35 p-4">
            <div className="overflow-hidden rounded-md border border-border bg-background">
              <div className="flex items-center justify-between border-b border-border px-3 py-2 text-xs">
                <span className="font-medium">Hosted draft</span>
                <span className="text-muted-foreground">private URL</span>
              </div>
              <div className="space-y-3 p-4">
                <div className="h-3 w-2/3 rounded bg-foreground" />
                <div className="h-2 w-full rounded bg-muted" />
                <div className="h-2 w-5/6 rounded bg-muted" />
                <div className="grid grid-cols-3 gap-2 pt-2">
                  <div className="rounded border border-border p-2">
                    <div className="mb-2 h-2 w-12 rounded bg-muted-foreground/40" />
                    <div className="h-8 rounded bg-muted" />
                  </div>
                  <div className="rounded border border-border p-2">
                    <div className="mb-2 h-2 w-12 rounded bg-muted-foreground/40" />
                    <div className="h-8 rounded bg-muted" />
                  </div>
                  <div className="rounded border border-border p-2">
                    <div className="mb-2 h-2 w-12 rounded bg-muted-foreground/40" />
                    <div className="h-8 rounded bg-muted" />
                  </div>
                </div>
                <div className="rounded border border-border">
                  <div className="grid grid-cols-3 border-b border-border text-xs text-muted-foreground">
                    <span className="px-3 py-2">File</span>
                    <span className="px-3 py-2">Owner</span>
                    <span className="px-3 py-2">Access</span>
                  </div>
                  <div className="grid grid-cols-3 text-xs">
                    <span className="px-3 py-2">plan.html</span>
                    <span className="px-3 py-2">agent</span>
                    <span className="px-3 py-2">team</span>
                  </div>
                </div>
              </div>
            </div>
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
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-14 lg:grid-cols-[320px_1fr]">
          <div>
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
          <pre className="mt-5 overflow-x-auto rounded-lg bg-foreground p-4 text-sm text-background"><code>{`docs-share login --token ds_...
docs-share draft ./plan.html
docs-share push ./site --to personal --message "Publish linked draft"`}</code></pre>
        </div>
      </section>
    </main>
  );
}
