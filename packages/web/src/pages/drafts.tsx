import { useMemo, useState } from "react";
import { Link } from "react-router";
import type { DraftListItem } from "@patra/shared";
import { EmptyState } from "@/components/common/empty-state";
import {
  useDeleteDraft,
  useDrafts,
  useDuplicateDraft,
} from "@/hooks/use-drafts";
import { useDraftAnalytics } from "@/hooks/use-analytics";
import { formatLastOpened, formatViewSummary } from "@/lib/view-analytics";

function DraftViewStat({ draftId }: { draftId: string }) {
  const { data: stats } = useDraftAnalytics(draftId);
  if (!stats) return null;
  return (
    <span className="truncate">
      {formatViewSummary(stats)}
      {stats.lastViewedAt
        ? ` · Last opened ${formatLastOpened(stats.lastViewedAt)}`
        : ""}
    </span>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function matchesDraft(draft: DraftListItem, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;

  return [draft.title, draft.sourceFilename, draft.id]
    .join(" ")
    .toLowerCase()
    .includes(normalized);
}

export function DraftsPage() {
  const { data: drafts, isLoading, isError } = useDrafts();
  const deleteDraft = useDeleteDraft();
  const duplicateDraft = useDuplicateDraft();
  const [query, setQuery] = useState("");
  const [copiedDraftId, setCopiedDraftId] = useState<string | null>(null);

  const filteredDrafts = useMemo(
    () => (drafts ?? []).filter((draft) => matchesDraft(draft, query)),
    [drafts, query],
  );

  const handleCopy = async (draft: DraftListItem) => {
    await navigator.clipboard.writeText(draft.url);
    setCopiedDraftId(draft.id);
    window.setTimeout(() => setCopiedDraftId(null), 1600);
  };

  const handleDelete = (draft: DraftListItem) => {
    if (!window.confirm(`Delete "${draft.title}"?`)) return;
    deleteDraft.mutate(draft.id);
  };

  const handleDuplicate = (draft: DraftListItem) => {
    duplicateDraft.mutate(draft.id);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6 lg:p-8">
      <section className="rounded-lg border border-border bg-background p-6 shadow-xl shadow-teal-950/5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#0f766e] dark:text-[#5eead4]">
              Draft publishing
            </p>
            <h1 className="mt-3 text-3xl font-semibold">Drafts</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Review private HTML drafts published by agents, copy links for collaborators, duplicate useful outputs, or inspect collected form data.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:min-w-80">
            <div className="rounded-lg border border-border bg-muted/25 p-4">
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Hosted
              </p>
              <p className="mt-2 text-3xl font-semibold">{drafts?.length ?? 0}</p>
            </div>
            <div className="rounded-lg border border-border bg-secondary/70 p-4">
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Filtered
              </p>
              <p className="mt-2 text-3xl font-semibold">{filteredDrafts.length}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-background p-5 shadow-sm">
        <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Hosted drafts</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {drafts
                ? `${drafts.length} total ${drafts.length === 1 ? "draft" : "drafts"}`
                : "Loading hosted drafts"}
            </p>
          </div>
          <div className="w-full sm:w-80">
          <label htmlFor="draft-search" className="sr-only">
            Search drafts
          </label>
          <input
            id="draft-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search drafts"
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary"
          />
          </div>
        </div>

        {isLoading ? (
          <p className="rounded-lg border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
            Loading drafts...
          </p>
        ) : isError ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            Drafts could not be loaded.
          </div>
        ) : filteredDrafts.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-border bg-muted/10">
          <div className="grid grid-cols-[minmax(0,1fr)_120px_180px_220px] gap-4 border-b border-border bg-muted/50 px-4 py-2 text-xs font-medium uppercase tracking-wider text-muted-foreground max-lg:hidden">
            <span>Draft</span>
            <span>Size</span>
            <span>Created</span>
            <span className="text-right">Actions</span>
          </div>
          <div className="divide-y divide-border">
            {filteredDrafts.map((draft) => (
              <div
                key={draft.id}
                className="grid gap-3 px-4 py-4 transition-colors hover:bg-accent/45 lg:grid-cols-[minmax(0,1fr)_120px_180px_220px] lg:items-center lg:gap-4"
              >
                <div className="min-w-0">
                  <a
                    href={draft.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate text-sm font-semibold text-foreground hover:text-primary"
                  >
                    {draft.title}
                  </a>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="truncate">{draft.sourceFilename}</span>
                    <span className="lg:hidden">{formatBytes(draft.sizeBytes)}</span>
                    <span className="lg:hidden">{formatDate(draft.createdAt)}</span>
                    <DraftViewStat draftId={draft.id} />
                  </div>
                </div>

                <span className="hidden text-sm text-muted-foreground lg:block">
                  {formatBytes(draft.sizeBytes)}
                </span>
                <span className="hidden text-sm text-muted-foreground lg:block">
                  {formatDate(draft.createdAt)}
                </span>

                <div className="flex flex-wrap justify-start gap-2 lg:justify-end">
                  <a
                    href={draft.url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
                  >
                    Open
                  </a>
                  <button
                    type="button"
                    onClick={() => handleCopy(draft)}
                    className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
                  >
                    {copiedDraftId === draft.id ? "Copied" : "Copy URL"}
                  </button>
                  <Link
                    to={`/drafts/${draft.id}/forms`}
                    className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
                  >
                    Forms
                  </Link>
                  <button
                    type="button"
                    onClick={() => handleDuplicate(draft)}
                    disabled={duplicateDraft.isPending}
                    className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
                  >
                    Duplicate
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(draft)}
                    disabled={deleteDraft.isPending}
                    className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium text-destructive transition-colors hover:bg-muted disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
        ) : drafts && drafts.length > 0 ? (
          <EmptyState
            title="No matching drafts"
            description="Try a different title, file name, or draft id."
          />
        ) : (
          <EmptyState
            title="No drafts yet"
            description="Drafts published by the CLI will appear here."
          />
        )}
      </section>
    </div>
  );
}
