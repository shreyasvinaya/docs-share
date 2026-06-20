import { useEffect, useState } from "react";
import { useSession } from "@/hooks/use-auth";
import {
  connectGitHubApp,
  useApiTokens,
  useCreateToken,
  useDeleteGitHubToken,
  useGitHubTokenStatus,
  useRevokeToken,
  useSaveGitHubToken,
  useUpdateProfile,
} from "@/hooks/use-auth";
import { UserAvatar } from "@/components/common/user-avatar";
import { cn } from "@/lib/utils";
import { getGitHubIntegrationView } from "@/lib/github-integration-status";
import { SetupChecklist } from "@/components/setup/setup-checklist";
import { useSetupStatus } from "@/hooks/use-setup";

type Tab = "profile" | "tokens" | "integrations" | "setup";

export function SettingsPage() {
  const { data: session } = useSession();
  const isSysadmin = session?.user.role === "sysadmin";
  const initialTab = new URLSearchParams(window.location.search).get("tab");
  const [tab, setTab] = useState<Tab>(
    initialTab === "integrations" ||
      initialTab === "tokens" ||
      initialTab === "setup"
      ? initialTab
      : "profile"
  );
  const activeTab = tab === "setup" && !isSysadmin ? "profile" : tab;

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-6 text-2xl font-bold">Settings</h1>

      <div className="mb-6 flex gap-1 border-b border-border">
        <button
          type="button"
          onClick={() => setTab("profile")}
          className={cn(
            "border-b-2 px-4 py-2 text-sm font-medium transition-colors",
            activeTab === "profile"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          Profile
        </button>
        <button
          type="button"
          onClick={() => setTab("tokens")}
          className={cn(
            "border-b-2 px-4 py-2 text-sm font-medium transition-colors",
            activeTab === "tokens"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          API Tokens
        </button>
        <button
          type="button"
          onClick={() => setTab("integrations")}
          className={cn(
            "border-b-2 px-4 py-2 text-sm font-medium transition-colors",
            activeTab === "integrations"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          Integrations
        </button>
        {isSysadmin && (
          <button
            type="button"
            onClick={() => setTab("setup")}
            className={cn(
              "border-b-2 px-4 py-2 text-sm font-medium transition-colors",
              activeTab === "setup"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            Setup
          </button>
        )}
      </div>

      {activeTab === "profile" && <ProfileTab />}
      {activeTab === "tokens" && <TokensTab />}
      {activeTab === "integrations" && <IntegrationsTab />}
      {activeTab === "setup" && isSysadmin && <SetupTab />}
    </div>
  );
}

function SetupTab() {
  const { data: status, isLoading, isError } = useSetupStatus();

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-semibold">Deployment setup</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Review deployment-wide configuration for this installation.
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
    </div>
  );
}

function IntegrationsTab() {
  const { data: githubToken, isLoading } = useGitHubTokenStatus();
  const saveGitHubToken = useSaveGitHubToken();
  const deleteGitHubToken = useDeleteGitHubToken();
  const [token, setToken] = useState("");
  const { connectedWithApp, connectedWithLegacyPat, showPatFallback } =
    getGitHubIntegrationView(githubToken);

  const handlePatSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!token.trim()) return;
    saveGitHubToken.mutate(token.trim(), {
      onSuccess: () => setToken(""),
    });
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border p-4">
        <h3 className="mb-1 text-sm font-semibold">GitHub imports</h3>
        <p className="mb-4 text-sm text-muted-foreground">
          Connect the GitHub App and choose the repositories that Docs Share can import.
        </p>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading GitHub status...</p>
        ) : connectedWithApp ? (
          <div className="mb-4 rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm">
            Connected
            {githubToken?.accountLogin && (
              <span className="text-muted-foreground"> to {githubToken.accountLogin}</span>
            )}
            {githubToken?.updatedAt && (
              <span className="text-muted-foreground">
                {" "}
                since {new Date(githubToken.updatedAt).toLocaleDateString()}
              </span>
            )}
          </div>
        ) : connectedWithLegacyPat ? (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            A legacy GitHub token is connected. Reconnect with the GitHub App to choose repository access in GitHub.
          </div>
        ) : (
          <div className="mb-4 rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
            No GitHub integration connected.
          </div>
        )}

        {githubToken?.configured ? (
          <button
            type="button"
            onClick={connectGitHubApp}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {connectedWithApp ? "Manage repository access" : "Connect GitHub"}
          </button>
        ) : (
          <p className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
            GitHub App integration is not configured on this server. Use a personal access token below.
          </p>
        )}

        {showPatFallback && (
          <form onSubmit={handlePatSubmit} className="mt-4 flex items-end gap-3">
            <div className="flex-1">
              <label
                htmlFor="github-token"
                className="mb-1 block text-sm font-medium"
              >
                Personal access token
              </label>
              <input
                id="github-token"
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="github_pat_..."
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Use a fine-grained token with read access to the repositories you want to import.
              </p>
            </div>
            <button
              type="submit"
              disabled={saveGitHubToken.isPending || !token.trim()}
              className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground transition-colors hover:bg-secondary/80 disabled:opacity-50"
            >
              {saveGitHubToken.isPending ? "Saving..." : "Save token"}
            </button>
          </form>
        )}

        {githubToken?.connected && (
          <button
            type="button"
            onClick={() => deleteGitHubToken.mutate()}
            disabled={deleteGitHubToken.isPending}
            className="mt-4 text-sm text-destructive transition-colors hover:text-destructive/80 disabled:opacity-50"
          >
            {deleteGitHubToken.isPending ? "Disconnecting..." : "Disconnect GitHub"}
          </button>
        )}
      </div>
    </div>
  );
}

function ProfileTab() {
  const { data: session } = useSession();
  const updateProfile = useUpdateProfile();
  const user = session?.user;
  const [displayName, setDisplayName] = useState("");
  const [designation, setDesignation] = useState("");

  useEffect(() => {
    if (!user) return;
    setDisplayName(user.displayName);
    setDesignation(user.designation ?? "");
  }, [user]);

  if (!user) return null;

  const hasChanges =
    displayName.trim() !== user.displayName ||
    designation.trim() !== (user.designation ?? "");

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!displayName.trim()) return;

    updateProfile.mutate({
      displayName: displayName.trim(),
      designation: designation.trim() || null,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <UserAvatar
          displayName={user.displayName}
          avatarUrl={user.avatarUrl}
          size="lg"
        />
        <div>
          <h2 className="text-lg font-semibold">{user.displayName}</h2>
          {user.designation && (
            <p className="text-sm text-muted-foreground">{user.designation}</p>
          )}
          <p className="text-sm text-muted-foreground">{user.email}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="rounded-lg border border-border p-4">
        <div className="space-y-4">
          <div>
            <label htmlFor="display-name" className="mb-1 block text-sm font-medium">
              Display Name
            </label>
            <input
              id="display-name"
              type="text"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              maxLength={100}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label htmlFor="designation" className="mb-1 block text-sm font-medium">
              Designation
            </label>
            <input
              id="designation"
              type="text"
              value={designation}
              onChange={(event) => setDesignation(event.target.value)}
              maxLength={120}
              placeholder="e.g., Product Engineer"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Google may provide this when available; otherwise set it here.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Email</label>
            <input
              type="text"
              readOnly
              value={user.email}
              className="w-full rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Email is managed by your Google account.
            </p>
          </div>
          {updateProfile.isError && (
            <p className="text-sm text-destructive">
              Profile update failed. Please check your values and try again.
            </p>
          )}
          <button
            type="submit"
            disabled={!hasChanges || updateProfile.isPending || !displayName.trim()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {updateProfile.isPending ? "Saving..." : "Save profile"}
          </button>
        </div>
      </form>
    </div>
  );
}

function TokensTab() {
  const { data: tokens, isLoading } = useApiTokens();
  const createToken = useCreateToken();
  const revokeToken = useRevokeToken();

  const [name, setName] = useState("");
  const [newTokenValue, setNewTokenValue] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    createToken.mutate(
      { name: name.trim(), scopes: "*" },
      {
        onSuccess: (data) => {
          setNewTokenValue(data.token);
          setName("");
        },
      },
    );
  };

  const handleCopy = () => {
    if (!newTokenValue) return;
    navigator.clipboard.writeText(newTokenValue);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Create token form */}
      <div className="rounded-lg border border-border p-4">
        <h3 className="mb-3 text-sm font-semibold">Create New Token</h3>
        <form onSubmit={handleCreate} className="flex items-end gap-3">
          <div className="flex-1">
            <label
              htmlFor="token-name"
              className="mb-1 block text-sm font-medium"
            >
              Token name
            </label>
            <input
              id="token-name"
              type="text"
              placeholder="e.g., CI/CD pipeline"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>
          <button
            type="submit"
            disabled={createToken.isPending || !name.trim()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {createToken.isPending ? "Creating..." : "Create Token"}
          </button>
        </form>
      </div>

      {/* New token display */}
      {newTokenValue && (
        <div className="rounded-lg border border-border bg-muted/50 p-4">
          <p className="mb-2 text-sm font-medium text-foreground">
            Token created. Copy it now -- you will not see it again.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={newTokenValue}
              className="flex-1 rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground"
            />
            <button
              type="button"
              onClick={handleCopy}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm transition-colors hover:bg-muted"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>
      )}

      {/* Token list */}
      <div>
        <h3 className="mb-3 text-sm font-semibold">Your Tokens</h3>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading tokens...</p>
        ) : tokens && tokens.length > 0 ? (
          <div className="rounded-lg border border-border">
            {tokens.map((token, i) => {
              const isRevoked = !!token.revokedAt;
              return (
                <div
                  key={token.id}
                  className={`flex items-center justify-between px-4 py-3 ${
                    i < tokens.length - 1 ? "border-b border-border" : ""
                  } ${isRevoked ? "opacity-60" : ""}`}
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{token.name}</p>
                      {isRevoked && (
                        <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-destructive">
                          Revoked
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="font-mono">{token.tokenPrefix}...</span>
                      <span>
                        Created{" "}
                        {new Date(token.createdAt).toLocaleDateString()}
                      </span>
                      {token.lastUsedAt && (
                        <span>
                          Last used{" "}
                          {new Date(token.lastUsedAt).toLocaleDateString()}
                        </span>
                      )}
                      {token.expiresAt && (
                        <span>
                          Expires{" "}
                          {new Date(token.expiresAt).toLocaleDateString()}
                        </span>
                      )}
                      {isRevoked && token.revokedAt && (
                        <span>
                          Revoked{" "}
                          {new Date(token.revokedAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  {isRevoked ? (
                    <span className="text-sm text-muted-foreground">
                      Revoked
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => revokeToken.mutate(token.id)}
                      disabled={revokeToken.isPending}
                      className="text-sm text-destructive transition-colors hover:text-destructive/80"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="rounded-lg border border-border px-4 py-8 text-center text-sm text-muted-foreground">
            No API tokens yet. Create one above.
          </p>
        )}
      </div>
    </div>
  );
}
