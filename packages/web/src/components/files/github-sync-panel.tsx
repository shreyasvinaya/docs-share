import { useEffect, useState } from "react";
import { useGitHubTokenStatus } from "@/hooks/use-auth";
import {
  useGitHubBranches,
  useGitHubOrganizations,
  useGitHubRepositories,
  useGitHubSync,
  useGitHubTree,
  useRunGitHubSync,
} from "@/hooks/use-files";
import { getGitHubPrivateRepoNotice } from "@/lib/github-sync-messages";

interface GitHubSyncPanelProps {
  repoId: string | undefined;
}

const OTHER_REPO_VALUE = "__other__";

export function GitHubSyncPanel({ repoId }: GitHubSyncPanelProps) {
  const { data: githubToken } = useGitHubTokenStatus();
  const { data: sync } = useGitHubSync(repoId);
  const runSync = useRunGitHubSync(repoId);
  const [ownerFilter, setOwnerFilter] = useState("");
  const repositories = useGitHubRepositories(repoId, ownerFilter, githubToken?.connected === true);
  const organizations = useGitHubOrganizations(repoId, githubToken?.connected === true);
  const [repoUrl, setRepoUrl] = useState("");
  const [repoChoice, setRepoChoice] = useState("");
  const [branch, setBranch] = useState("main");
  const [browsePath, setBrowsePath] = useState("");
  const [selectedPath, setSelectedPath] = useState("");
  const lookupRepoUrl = isCompleteGitHubUrl(repoUrl) ? repoUrl.trim() : "";
  const branches = useGitHubBranches(repoId, lookupRepoUrl, !!lookupRepoUrl);
  const tree = useGitHubTree(repoId, lookupRepoUrl, branch.trim(), browsePath);
  const showManualUrl =
    githubToken?.connected !== true || repoChoice === OTHER_REPO_VALUE || repositories.isError;
  const branchOptions = branches.data ?? [];
  const privateRepoNotice = getGitHubPrivateRepoNotice({
    tokenConnected: githubToken?.connected === true,
    repositories: repositories.data,
    isLoading: repositories.isLoading,
    isError: repositories.isError,
    ownerFilter,
  });

  useEffect(() => {
    if (sync) {
      setRepoUrl(sync.repoUrl);
      setBranch(sync.branch);
      setSelectedPath(sync.sourcePath ?? "");
      setRepoChoice(OTHER_REPO_VALUE);
    }
  }, [sync]);

  useEffect(() => {
    if (!sync || !repositories.data) return;
    const matchingRepo = repositories.data.find((repo) => repo.repoUrl === sync.repoUrl);
    if (matchingRepo) setRepoChoice(matchingRepo.fullName);
  }, [repositories.data, sync]);

  useEffect(() => {
    if (!branchOptions.length || !repoUrl.trim()) return;
    if (!branch.trim() || !branchOptions.includes(branch)) {
      setBranch(branchOptions[0]);
    }
  }, [branch, branchOptions, repoUrl]);

  const canSync =
    !!repoId && !!repoUrl.trim() && !!branch.trim() && !runSync.isPending;
  const crumbs = browsePath ? browsePath.split("/") : [];

  return (
    <section className="mb-6 rounded-lg border border-border p-4">
      <div className="mb-3">
        <h2 className="text-sm font-semibold">GitHub sync</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Import from repositories your GitHub token can access, or enter another GitHub URL.
        </p>
      </div>
      <form
        className={
          githubToken?.connected === true
            ? "grid gap-3 md:grid-cols-[12rem_1fr_10rem_auto]"
            : "grid gap-3 md:grid-cols-[1fr_10rem_auto]"
        }
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSync) return;
          runSync.mutate({
            repoUrl: repoUrl.trim(),
            branch: branch.trim() || "main",
            sourcePath: selectedPath,
          });
        }}
      >
        {githubToken?.connected === true && (
          <select
            value={ownerFilter}
            onChange={(event) => {
              setOwnerFilter(event.target.value);
              setRepoChoice("");
              setRepoUrl("");
              setBranch("main");
              setBrowsePath("");
              setSelectedPath("");
            }}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">
              {organizations.isLoading ? "Loading orgs..." : "All repositories"}
            </option>
            {organizations.data?.map((organization) => (
              <option key={organization.login} value={organization.login}>
                {organization.login}
              </option>
            ))}
          </select>
        )}
        <div className="grid gap-2">
          {githubToken?.connected === true && (
            <select
              value={repoChoice}
              onChange={(event) => {
                const value = event.target.value;
                setRepoChoice(value);
                setBrowsePath("");
                setSelectedPath("");

                if (!value) {
                  setRepoUrl("");
                  setBranch("main");
                  return;
                }
                if (value === OTHER_REPO_VALUE) {
                  setRepoUrl("");
                  setBranch("main");
                  return;
                }

                const repository = repositories.data?.find(
                  (repo) => repo.fullName === value
                );
                if (repository) {
                  setRepoUrl(repository.repoUrl);
                  setBranch(repository.defaultBranch || "main");
                }
              }}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">
                {repositories.isLoading
                  ? "Loading repositories..."
                  : ownerFilter
                    ? `Choose from ${ownerFilter}`
                    : "Choose a repository"}
              </option>
              {repositories.data?.map((repository) => (
                <option key={repository.fullName} value={repository.fullName}>
                  {repository.fullName}
                  {repository.private ? " (private)" : ""}
                </option>
              ))}
              <option value={OTHER_REPO_VALUE}>Other URL...</option>
            </select>
          )}
          {showManualUrl && (
            <input
              value={repoUrl}
              onChange={(event) => {
                setRepoUrl(event.target.value);
                setBrowsePath("");
                setSelectedPath("");
              }}
              placeholder="https://github.com/owner/repo"
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          )}
        </div>
        {repoUrl.trim() ? (
          branchOptions.length > 0 ? (
            <select
              value={branchOptions.includes(branch) ? branch : branchOptions[0]}
              onChange={(event) => {
                setBranch(event.target.value);
                setBrowsePath("");
                setSelectedPath("");
              }}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              {branchOptions.map((branchName) => (
                <option key={branchName} value={branchName}>
                  {branchName}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={branch}
              onChange={(event) => {
                setBranch(event.target.value);
                setBrowsePath("");
                setSelectedPath("");
              }}
              placeholder={branches.isLoading ? "Loading..." : "main"}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          )
        ) : (
          <div />
        )}
        <button
          type="submit"
          disabled={!canSync}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
        >
          {runSync.isPending ? "Syncing..." : "Sync"}
        </button>
      </form>
      {privateRepoNotice && (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {privateRepoNotice}
        </p>
      )}
      {repoUrl.trim() && branch.trim() && (
        <div className="mt-4 rounded-lg border border-border">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-xs">
            <button
              type="button"
              onClick={() => setBrowsePath("")}
              className="font-medium text-muted-foreground hover:text-foreground"
            >
              root
            </button>
            {crumbs.map((crumb, index) => {
              const path = crumbs.slice(0, index + 1).join("/");
              return (
                <button
                  key={path}
                  type="button"
                  onClick={() => setBrowsePath(path)}
                  className="font-medium text-muted-foreground hover:text-foreground"
                >
                  / {crumb}
                </button>
              );
            })}
            <span className="ml-auto text-muted-foreground">
              {selectedPath ? `Selected: ${selectedPath}` : "Selected: repository root"}
            </span>
          </div>
          <div className="max-h-56 overflow-y-auto">
            {tree.isLoading ? (
              <p className="px-3 py-3 text-sm text-muted-foreground">Loading repository tree...</p>
            ) : tree.isError ? (
              <p className="px-3 py-3 text-sm text-destructive">
                Could not load repository tree. Check the URL, branch, and your GitHub token in Settings.
              </p>
            ) : tree.data && tree.data.length > 0 ? (
              <ul className="divide-y divide-border">
                {tree.data.map((node) => (
                  <li key={node.path} className="flex items-center gap-2 px-3 py-2">
                    <button
                      type="button"
                      onClick={() => setSelectedPath(node.path)}
                      className="rounded border border-border px-2 py-1 text-xs font-medium hover:bg-muted"
                    >
                      Select
                    </button>
                    {node.type === "directory" ? (
                      <button
                        type="button"
                        onClick={() => setBrowsePath(node.path)}
                        className="flex-1 truncate text-left text-sm font-medium hover:underline"
                      >
                        {node.name}/
                      </button>
                    ) : (
                      <span className="flex-1 truncate text-sm">{node.name}</span>
                    )}
                    {node.size !== null && (
                      <span className="text-xs text-muted-foreground">{node.size} B</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-3 py-3 text-sm text-muted-foreground">No files found at this path.</p>
            )}
          </div>
        </div>
      )}
      {(sync || runSync.isError) && (
        <p className="mt-3 text-xs text-muted-foreground">
          {runSync.isError
            ? "GitHub sync failed."
            : sync?.status === "success" && sync.lastSyncedAt
              ? `Last synced ${new Date(sync.lastSyncedAt).toLocaleString()} at ${sync.lastCommitSha?.slice(0, 7) ?? "unknown commit"}${sync.sourcePath ? ` from ${sync.sourcePath}` : ""}.`
              : sync?.status === "error"
                ? `Last sync failed: ${sync.error ?? "unknown error"}`
                : `Status: ${sync?.status ?? "not configured"}`}
        </p>
      )}
    </section>
  );
}

function isCompleteGitHubUrl(repoUrl: string): boolean {
  try {
    const parsed = new URL(repoUrl.trim());
    const parts = parsed.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
    return parsed.protocol === "https:" && parsed.hostname === "github.com" && parts.length === 2;
  } catch {
    return false;
  }
}
