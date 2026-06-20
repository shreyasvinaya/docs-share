import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import type { SiteDataRecord } from "@docs-share/shared";
import { EmptyState } from "@/components/common/empty-state";
import {
  siteDataTarget,
  useDeleteSiteDataRecord,
  useDisableSiteDataCollection,
  useEnableSiteDataCollection,
  useSiteDataCollections,
  useSiteDataRecords,
} from "@/hooks/use-site-data";

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatFieldValue(value: string | number | boolean | null): string {
  if (value === null) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function RecordCard({
  record,
  onDelete,
  isDeleting,
}: {
  record: SiteDataRecord;
  onDelete: () => void;
  isDeleting: boolean;
}) {
  const entries = Object.entries(record.fields);
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {formatDate(record.createdAt)} · {record.collection}
        </span>
        <button
          type="button"
          onClick={onDelete}
          disabled={isDeleting}
          className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-destructive transition-colors hover:bg-muted disabled:opacity-50"
        >
          Delete
        </button>
      </div>
      <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[160px_minmax(0,1fr)]">
        {entries.map(([key, value]) => (
          <div key={key} className="contents">
            <dt className="truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {key}
            </dt>
            <dd className="min-w-0 break-words text-sm text-foreground">
              {formatFieldValue(value)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function DraftFormsPage() {
  const { draftId = "" } = useParams();
  const target = siteDataTarget("draft", draftId);

  const collections = useSiteDataCollections(target);
  const [activeCollection, setActiveCollection] = useState<string | undefined>(
    undefined
  );
  const records = useSiteDataRecords(target, activeCollection);
  const enableCollection = useEnableSiteDataCollection(target);
  const disableCollection = useDisableSiteDataCollection(target);
  const deleteRecord = useDeleteSiteDataRecord(target);
  const [newCollection, setNewCollection] = useState("");

  const collectionList = collections.data ?? [];
  const recordList = useMemo(() => records.data ?? [], [records.data]);

  const handleEnable = (event: React.FormEvent) => {
    event.preventDefault();
    const name = newCollection.trim();
    if (!name) return;
    enableCollection.mutate(name, { onSuccess: () => setNewCollection("") });
  };

  const handleDeleteRecord = (record: SiteDataRecord) => {
    if (!window.confirm("Delete this submission?")) return;
    deleteRecord.mutate(record.id);
  };

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6">
        <Link
          to="/drafts"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Back to drafts
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Form responses</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Collect form submissions from this hosted draft. Enable a collection
          name, then have your page POST JSON to{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">
            /api/sites/{target}/data/&lt;collection&gt;
          </code>
          .
        </p>
      </div>

      <section className="mb-8 rounded-lg border border-border p-4">
        <h2 className="text-sm font-semibold">Collections</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          A draft only accepts submissions to collections you have enabled here.
        </p>

        <form onSubmit={handleEnable} className="mt-3 flex gap-2">
          <input
            type="text"
            value={newCollection}
            onChange={(event) => setNewCollection(event.target.value)}
            placeholder="e.g. contact"
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          />
          <button
            type="submit"
            disabled={enableCollection.isPending || !newCollection.trim()}
            className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            Enable
          </button>
        </form>

        {collectionList.length > 0 ? (
          <ul className="mt-4 flex flex-wrap gap-2">
            <li>
              <button
                type="button"
                onClick={() => setActiveCollection(undefined)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  activeCollection === undefined
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border hover:bg-muted"
                }`}
              >
                All
              </button>
            </li>
            {collectionList.map((collection) => (
              <li key={collection.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setActiveCollection(collection.collection)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    activeCollection === collection.collection
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border hover:bg-muted"
                  } ${collection.enabled ? "" : "opacity-50"}`}
                >
                  {collection.collection}
                  {collection.enabled ? "" : " (disabled)"}
                </button>
                {collection.enabled && (
                  <button
                    type="button"
                    onClick={() =>
                      disableCollection.mutate(collection.collection)
                    }
                    disabled={disableCollection.isPending}
                    title="Stop accepting submissions"
                    className="rounded-full border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
                  >
                    Disable
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">
          Submissions
          {recordList.length > 0 ? ` (${recordList.length})` : ""}
        </h2>
        {records.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading submissions...</p>
        ) : records.isError ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            Submissions could not be loaded.
          </div>
        ) : recordList.length > 0 ? (
          <div className="space-y-3">
            {recordList.map((record) => (
              <RecordCard
                key={record.id}
                record={record}
                onDelete={() => handleDeleteRecord(record)}
                isDeleting={deleteRecord.isPending}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            title="No submissions yet"
            description="Responses to your hosted form will appear here."
          />
        )}
      </section>
    </div>
  );
}
