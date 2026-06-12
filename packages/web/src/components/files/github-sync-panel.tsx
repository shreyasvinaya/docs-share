import { useEffect, useState } from "react";
import { useGitHubSync, useRunGitHubSync } from "@/hooks/use-files";

interface GitHubSyncPanelProps {
  repoId: string | undefined;
}

export function GitHubSyncPanel({ repoId }: GitHubSyncPanelProps) {
  const { data: sync } = useGitHubSync(repoId);
  const runSync = useRunGitHubSync(repoId);
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");

  useEffect(() => {
    if (sync) {
      setRepoUrl(sync.repoUrl);
      setBranch(sync.branch);
    }
  }, [sync]);

  const canSync = !!repoId && !!repoUrl.trim() && !runSync.isPending;

  return (
    <section className="mb-6 rounded-lg border border-border p-4">
      <div className="mb-3">
        <h2 className="text-sm font-semibold">GitHub sync</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Import a public GitHub branch and keep linked HTML files in the same path tree.
        </p>
      </div>
      <form
        className="grid gap-3 md:grid-cols-[1fr_10rem_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSync) return;
          runSync.mutate({ repoUrl: repoUrl.trim(), branch: branch.trim() || "main" });
        }}
      >
        <input
          value={repoUrl}
          onChange={(event) => setRepoUrl(event.target.value)}
          placeholder="https://github.com/owner/repo"
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <input
          value={branch}
          onChange={(event) => setBranch(event.target.value)}
          placeholder="main"
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={!canSync}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
        >
          {runSync.isPending ? "Syncing..." : "Sync"}
        </button>
      </form>
      {(sync || runSync.isError) && (
        <p className="mt-3 text-xs text-muted-foreground">
          {runSync.isError
            ? "GitHub sync failed."
            : sync?.status === "success" && sync.lastSyncedAt
              ? `Last synced ${new Date(sync.lastSyncedAt).toLocaleString()} at ${sync.lastCommitSha?.slice(0, 7) ?? "unknown commit"}.`
              : sync?.status === "error"
                ? `Last sync failed: ${sync.error ?? "unknown error"}`
                : `Status: ${sync?.status ?? "not configured"}`}
        </p>
      )}
    </section>
  );
}
