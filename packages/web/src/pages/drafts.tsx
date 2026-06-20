import { useMemo, useState } from "react";
import type { DraftListItem } from "@docs-share/shared";
import { EmptyState } from "@/components/common/empty-state";
import {
  useDeleteDraft,
  useDrafts,
  useDuplicateDraft,
} from "@/hooks/use-drafts";

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
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Drafts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {drafts ? `${drafts.length} hosted ${drafts.length === 1 ? "draft" : "drafts"}` : "Hosted drafts"}
          </p>
        </div>
        <div className="w-full sm:w-72">
          <label htmlFor="draft-search" className="sr-only">
            Search drafts
          </label>
          <input
            id="draft-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search drafts"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading drafts...</p>
      ) : isError ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Drafts could not be loaded.
        </div>
      ) : filteredDrafts.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-border">
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
                className="grid gap-3 px-4 py-4 transition-colors hover:bg-muted/30 lg:grid-cols-[minmax(0,1fr)_120px_180px_220px] lg:items-center lg:gap-4"
              >
                <div className="min-w-0">
                  <a
                    href={draft.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate text-sm font-semibold text-foreground hover:underline"
                  >
                    {draft.title}
                  </a>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="truncate">{draft.sourceFilename}</span>
                    <span className="lg:hidden">{formatBytes(draft.sizeBytes)}</span>
                    <span className="lg:hidden">{formatDate(draft.createdAt)}</span>
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
                    className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
                  >
                    Open
                  </a>
                  <button
                    type="button"
                    onClick={() => handleCopy(draft)}
                    className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
                  >
                    {copiedDraftId === draft.id ? "Copied" : "Copy URL"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDuplicate(draft)}
                    disabled={duplicateDraft.isPending}
                    className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
                  >
                    Duplicate
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(draft)}
                    disabled={deleteDraft.isPending}
                    className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-destructive transition-colors hover:bg-muted disabled:opacity-50"
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
    </div>
  );
}
