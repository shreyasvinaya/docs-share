import { useState, useEffect } from "react";
import {
  useCreateEmailShare,
  useCreatePublicLink,
  useCreateTeamShare,
  useSharesForResource,
  useRevokeShare,
} from "@/hooks/use-sharing";
import { useTeams } from "@/hooks/use-teams";
import { useShareAnalytics } from "@/hooks/use-analytics";
import { cn } from "@/lib/utils";
import { formatLastOpened, formatViewSummary } from "@/lib/view-analytics";
import type { SharePermission, LinkAccess } from "@docs-share/shared";

interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  repoId: string;
  path?: string | null;
  fileName?: string;
}

export function ShareDialog({
  open,
  onClose,
  repoId,
  path,
  fileName,
}: ShareDialogProps) {
  const [tab, setTab] = useState<"email" | "team" | "link">("email");
  const [emails, setEmails] = useState("");
  const [teamId, setTeamId] = useState("");
  const [permission, setPermission] = useState<SharePermission>("read");
  const [linkAccess, setLinkAccess] = useState<LinkAccess>("public");
  const [initialTabSet, setInitialTabSet] = useState(false);

  const emailShare = useCreateEmailShare();
  const teamShare = useCreateTeamShare();
  const publicLink = useCreatePublicLink();
  const revokeShare = useRevokeShare();
  const { data: teams } = useTeams();
  const { data: existingShares, refetch } = useSharesForResource(
    open ? repoId : undefined,
    path
  );

  const existingPublicLink = existingShares?.find(
    (s) => s.shareType === "public_link"
  );

  const { data: analytics } = useShareAnalytics(
    existingPublicLink?.id,
    open && tab === "link" && !!existingPublicLink
  );

  useEffect(() => {
    if (existingPublicLink?.linkAccess) {
      setLinkAccess(existingPublicLink.linkAccess as LinkAccess);
    }
  }, [existingPublicLink]);

  useEffect(() => {
    if (!initialTabSet && existingShares) {
      if (existingPublicLink) {
        setTab("link");
      }
      setInitialTabSet(true);
    }
  }, [existingShares, existingPublicLink, initialTabSet]);

  useEffect(() => {
    if (!open) {
      setInitialTabSet(false);
    }
  }, [open]);

  if (!open) return null;

  const publicUrl = existingPublicLink?.publicToken
    ? `${window.location.origin}/view/public/${existingPublicLink.publicToken}/`
    : null;

  const handleEmailShare = () => {
    const parsed = emails
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);
    if (parsed.length === 0) return;

    emailShare.mutate(
      { repoId, path: path ?? undefined, emails: parsed, permission },
      {
        onSuccess: () => {
          setEmails("");
          refetch();
        },
      }
    );
  };

  const handleCreateOrUpdateLink = () => {
    publicLink.mutate(
      { repoId, path: path ?? undefined, linkAccess },
      {
        onSuccess: () => {
          refetch();
        },
      }
    );
  };

  const handleTeamShare = () => {
    if (!teamId) return;

    teamShare.mutate(
      { repoId, path: path ?? undefined, teamId, permission },
      {
        onSuccess: () => {
          setTeamId("");
          refetch();
        },
      }
    );
  };

  const handleRevokeLink = () => {
    if (!existingPublicLink) return;
    revokeShare.mutate(existingPublicLink.id, {
      onSuccess: () => refetch(),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
        role="button"
        tabIndex={0}
        aria-label="Close dialog"
      />
      <div className="relative w-full max-w-md rounded-xl border border-border bg-background p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            Share{fileName ? `: ${fileName}` : ""}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="mb-4 flex gap-1 rounded-lg bg-muted p-1">
          <button
            type="button"
            onClick={() => setTab("email")}
            className={cn(
              "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              tab === "email"
                ? "bg-background shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Email
          </button>
          <button
            type="button"
            onClick={() => setTab("team")}
            className={cn(
              "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              tab === "team"
                ? "bg-background shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Team
          </button>
          <button
            type="button"
            onClick={() => setTab("link")}
            className={cn(
              "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              tab === "link"
                ? "bg-background shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Link
          </button>
        </div>

        {tab === "email" && (
          <div className="space-y-3">
            <div>
              <label
                htmlFor="share-emails"
                className="mb-1 block text-sm font-medium"
              >
                Email addresses
              </label>
              <input
                id="share-emails"
                type="text"
                placeholder="user@example.com, another@example.com"
                value={emails}
                onChange={(e) => setEmails(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label
                htmlFor="share-permission"
                className="mb-1 block text-sm font-medium"
              >
                Permission
              </label>
              <select
                id="share-permission"
                value={permission}
                onChange={(e) =>
                  setPermission(e.target.value as SharePermission)
                }
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="read">Can view</option>
                <option value="write">Can edit</option>
              </select>
            </div>

            {/* Show existing email shares */}
            {existingShares?.filter((s) => s.shareType === "email").length ? (
              <div className="rounded-lg border border-border p-3">
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  Shared with
                </p>
                {existingShares
                  .filter((s) => s.shareType === "email")
                  .map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between py-1"
                    >
                      <span className="text-sm">{s.path ?? "All files"}</span>
                      <button
                        type="button"
                        onClick={() =>
                          revokeShare.mutate(s.id, {
                            onSuccess: () => refetch(),
                          })
                        }
                        className="text-xs text-destructive hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
              </div>
            ) : null}

            <button
              type="button"
              onClick={handleEmailShare}
              disabled={emailShare.isPending || !emails.trim()}
              className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {emailShare.isPending ? "Sharing..." : "Share"}
            </button>
          </div>
        )}

        {tab === "team" && (
          <div className="space-y-3">
            <div>
              <label
                htmlFor="share-team"
                className="mb-1 block text-sm font-medium"
              >
                Team
              </label>
              <select
                id="share-team"
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="">Choose a team</option>
                {teams?.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="share-team-permission"
                className="mb-1 block text-sm font-medium"
              >
                Permission
              </label>
              <select
                id="share-team-permission"
                value={permission}
                onChange={(e) =>
                  setPermission(e.target.value as SharePermission)
                }
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="read">Can view</option>
                <option value="write">Can edit</option>
              </select>
            </div>

            {existingShares?.filter((s) => s.shareType === "team").length ? (
              <div className="rounded-lg border border-border p-3">
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  Shared with teams
                </p>
                {existingShares
                  .filter((s) => s.shareType === "team")
                  .map((s) => {
                    const team = teams?.find((item) => item.id === s.teamId);
                    return (
                      <div
                        key={s.id}
                        className="flex items-center justify-between py-1"
                      >
                        <span className="text-sm">
                          {team?.name ?? s.teamId ?? "Team"} · {s.permission}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            revokeShare.mutate(s.id, {
                              onSuccess: () => refetch(),
                            })
                          }
                          className="text-xs text-destructive hover:underline"
                        >
                          Remove
                        </button>
                      </div>
                    );
                  })}
              </div>
            ) : null}

            <button
              type="button"
              onClick={handleTeamShare}
              disabled={teamShare.isPending || !teamId}
              className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {teamShare.isPending ? "Sharing..." : "Share with team"}
            </button>
          </div>
        )}

        {tab === "link" && (
          <div className="space-y-3">
            {/* Access level selector */}
            <div>
              <p className="mb-2 text-sm font-medium">Who can access</p>
              <div className="space-y-2">
                <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted/50 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                  <input
                    type="radio"
                    name="linkAccess"
                    value="public"
                    checked={linkAccess === "public"}
                    onChange={() => setLinkAccess("public")}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-sm font-medium">Anyone with the link</p>
                    <p className="text-xs text-muted-foreground">
                      No sign-in required. Anyone can view.
                    </p>
                  </div>
                </label>
                <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted/50 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                  <input
                    type="radio"
                    name="linkAccess"
                    value="org"
                    checked={linkAccess === "org"}
                    onChange={() => setLinkAccess("org")}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-sm font-medium">
                      Anyone in your organization
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Only signed-in users with your email domain can view.
                    </p>
                  </div>
                </label>
              </div>
            </div>

            {publicUrl ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={publicUrl}
                    className="flex-1 rounded-lg border border-border bg-muted px-3 py-2 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(publicUrl)}
                    className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
                  >
                    Copy
                  </button>
                </div>

                {existingPublicLink?.orgDomain && (
                  <p className="text-xs text-muted-foreground">
                    Restricted to @{existingPublicLink.orgDomain}
                  </p>
                )}

                {/* Update access level if changed */}
                {existingPublicLink &&
                  linkAccess !== existingPublicLink.linkAccess && (
                    <button
                      type="button"
                      onClick={handleCreateOrUpdateLink}
                      disabled={publicLink.isPending}
                      className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                    >
                      {publicLink.isPending
                        ? "Updating..."
                        : `Update to ${linkAccess === "org" ? "org-only" : "public"}`}
                    </button>
                  )}

                <div className="flex items-center justify-between">
                  <p className="text-xs text-green-600 dark:text-green-400">
                    Link active
                  </p>
                  <button
                    type="button"
                    onClick={handleRevokeLink}
                    disabled={revokeShare.isPending}
                    className="text-xs text-destructive hover:underline"
                  >
                    {revokeShare.isPending ? "Removing..." : "Remove link"}
                  </button>
                </div>

                {analytics && (
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-sm font-medium">
                      {formatViewSummary(analytics)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Last opened: {formatLastOpened(analytics.lastViewedAt)}
                    </p>
                    {analytics.recentReferrers.length > 0 && (
                      <div className="mt-2">
                        <p className="text-xs font-medium text-muted-foreground">
                          Recent referrers
                        </p>
                        <ul className="mt-1 space-y-0.5">
                          {analytics.recentReferrers.map((ref) => (
                            <li
                              key={ref}
                              className="truncate text-xs text-muted-foreground"
                            >
                              {ref}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={handleCreateOrUpdateLink}
                disabled={publicLink.isPending}
                className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {publicLink.isPending
                  ? "Creating..."
                  : linkAccess === "org"
                    ? "Create Org Link"
                    : "Create Public Link"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
