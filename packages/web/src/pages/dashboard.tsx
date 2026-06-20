import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { usePersonalRepo } from "@/hooks/use-personal-repo";
import { useFiles } from "@/hooks/use-files";
import { useDrafts } from "@/hooks/use-drafts";
import { useTeams } from "@/hooks/use-teams";
import { useIncomingShares } from "@/hooks/use-sharing";
import { EmptyState } from "@/components/common/empty-state";
import { CreateTeamDialog } from "@/components/teams/create-team-dialog";

export function DashboardPage() {
  const navigate = useNavigate();
  const [showCreateTeam, setShowCreateTeam] = useState(false);
  const { data: personalRepo } = usePersonalRepo();
  const repoId = personalRepo?.repo?.id;
  const { data: files } = useFiles(repoId);
  const { data: drafts } = useDrafts();
  const { data: teams } = useTeams();
  const { data: incoming } = useIncomingShares();

  const recentFiles = (files ?? []).slice(0, 8);
  const recentDrafts = (drafts ?? []).slice(0, 5);
  const recentShared = (incoming ?? []).slice(0, 5);
  const totalFiles = files?.length ?? 0;
  const totalDrafts = drafts?.length ?? 0;
  const totalTeams = teams?.length ?? 0;
  const totalShared = incoming?.length ?? 0;

  return (
    <div className="mx-auto max-w-7xl space-y-8 p-6 lg:p-8">
      <section className="overflow-hidden rounded-lg border border-border bg-background shadow-xl shadow-teal-950/5">
        <div className="grid gap-6 bg-[radial-gradient(circle_at_top_right,rgba(20,184,166,0.22),transparent_34%),linear-gradient(135deg,rgba(15,118,110,0.12),rgba(215,168,47,0.10))] p-6 lg:grid-cols-[1fr_360px] lg:p-8">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#0f766e] dark:text-[#5eead4]">
              Workspace
            </p>
            <h1 className="mt-3 max-w-3xl text-3xl font-semibold leading-tight sm:text-4xl">
              Publish, review, and govern every shared artifact from one place.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground">
              Upload static files, inspect private drafts, manage team spaces, and keep API tokens close to the publishing workflow.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => navigate("/files")}
                className="rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-[#115e59]"
              >
                Upload HTML
              </button>
              <button
                type="button"
                onClick={() => navigate("/drafts")}
                className="rounded-lg border border-border bg-background/80 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
              >
                Review drafts
              </button>
              <button
                type="button"
                onClick={() => setShowCreateTeam(true)}
                className="rounded-lg border border-border bg-background/80 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
              >
                Create team
              </button>
              <Link
                to="/settings"
                className="rounded-lg border border-border bg-background/80 px-4 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
              >
                API tokens
              </Link>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-3">
            {[
              ["Files", totalFiles],
              ["Drafts", totalDrafts],
              ["Teams", totalTeams],
              ["Shared", totalShared],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-lg border border-border bg-background/80 p-4"
              >
                <dt className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  {label}
                </dt>
                <dd className="mt-2 text-3xl font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Recent files */}
      <section className="rounded-lg border border-border bg-background p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Recent Files</h2>
          <Link
            to="/files"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            View all
          </Link>
        </div>
        {recentFiles.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {recentFiles.map((file) => (
              <Link
                key={file.path}
                to={
                  file.type === "directory"
                    ? `/files/${file.path}`
                    : `/preview/${repoId}/${file.path}`
                }
                className="group rounded-lg border border-border bg-muted/20 p-4 transition-colors hover:border-[#0f766e]/30 hover:bg-accent/55"
              >
                <div className="mb-2">
                  {file.type === "directory" ? (
                    <svg className="h-8 w-8 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                    </svg>
                  ) : (
                    <svg className="h-8 w-8 text-blue-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                    </svg>
                  )}
                </div>
                <p className="truncate text-sm font-medium group-hover:text-foreground">
                  {file.name}
                </p>
                {file.updatedAt && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {new Date(file.updatedAt).toLocaleDateString()}
                  </p>
                )}
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No files yet"
            description="Upload your first HTML file to get started."
            action={
              <Link
                to="/files"
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Go to Files
              </Link>
            }
          />
        )}
      </section>

      {/* Recent drafts */}
      <section className="rounded-lg border border-border bg-background p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Recent Drafts</h2>
          <Link
            to="/drafts"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            View all
          </Link>
        </div>
        {recentDrafts.length > 0 ? (
          <div className="overflow-hidden rounded-lg border border-border bg-muted/15">
            {recentDrafts.map((draft, i) => (
              <a
                key={draft.id}
                href={draft.url}
                target="_blank"
                rel="noreferrer"
                className={`flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-muted/50 ${
                  i < recentDrafts.length - 1 ? "border-b border-border" : ""
                }`}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{draft.title}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {draft.sourceFilename}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {new Date(draft.createdAt).toLocaleDateString()}
                </span>
              </a>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No drafts yet"
            description="Drafts published by the CLI will appear here."
            action={
              <Link
                to="/drafts"
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Open Drafts
              </Link>
            }
          />
        )}
      </section>

      {/* Your teams */}
      <section className="rounded-lg border border-border bg-background p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Your Teams</h2>
          <Link
            to="/teams"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            View all
          </Link>
        </div>
        {teams && teams.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {teams.map((team) => (
              <Link
                key={team.id}
                to={`/teams/${team.id}`}
                className="group rounded-lg border border-border bg-muted/20 p-4 transition-colors hover:border-[#0f766e]/30 hover:bg-accent/55"
              >
                <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
                  {team.name[0].toUpperCase()}
                </div>
                <p className="truncate text-sm font-medium group-hover:text-foreground">
                  {team.name}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {team.slug}
                </p>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No teams yet"
            description="Create a team to collaborate with others."
            action={
              <button
                type="button"
                onClick={() => setShowCreateTeam(true)}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Create Team
              </button>
            }
          />
        )}
      </section>

      {/* Shared with me */}
      <section className="rounded-lg border border-border bg-background p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Shared with Me</h2>
          <Link
            to="/shared"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            View all
          </Link>
        </div>
        {recentShared.length > 0 ? (
          <div className="overflow-hidden rounded-lg border border-border bg-muted/15">
            {recentShared.map((item, i) => (
              <Link
                key={item.share.id}
                to={`/preview/${item.share.repoId}/${item.share.path ?? ""}`}
                className={`flex items-center justify-between px-4 py-3 transition-colors hover:bg-muted/50 ${
                  i < recentShared.length - 1 ? "border-b border-border" : ""
                }`}
              >
                <div className="flex items-center gap-3">
                  <svg className="h-5 w-5 text-blue-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                  <div>
                    <p className="text-sm font-medium">{item.fileName}</p>
                    <p className="text-xs text-muted-foreground">
                      from {item.ownerName}
                    </p>
                  </div>
                </div>
                <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
                  {item.share.permission}
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState
            title="Nothing shared yet"
            description="Files shared with you will appear here."
          />
        )}
      </section>

      <CreateTeamDialog
        open={showCreateTeam}
        onClose={() => setShowCreateTeam(false)}
        onCreated={(teamId) => navigate(`/teams/${teamId}`)}
      />
    </div>
  );
}
