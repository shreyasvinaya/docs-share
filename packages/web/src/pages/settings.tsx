import { useState } from "react";
import { useSession } from "@/hooks/use-auth";
import {
  useApiTokens,
  useCreateToken,
  useRevokeToken,
} from "@/hooks/use-auth";
import { UserAvatar } from "@/components/common/user-avatar";
import { cn } from "@/lib/utils";

type Tab = "profile" | "tokens";

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>("profile");

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-6 text-2xl font-bold">Settings</h1>

      <div className="mb-6 flex gap-1 border-b border-border">
        <button
          type="button"
          onClick={() => setTab("profile")}
          className={cn(
            "border-b-2 px-4 py-2 text-sm font-medium transition-colors",
            tab === "profile"
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
            tab === "tokens"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          API Tokens
        </button>
      </div>

      {tab === "profile" && <ProfileTab />}
      {tab === "tokens" && <TokensTab />}
    </div>
  );
}

function ProfileTab() {
  const { data: session } = useSession();
  const user = session?.user;

  if (!user) return null;

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
          <p className="text-sm text-muted-foreground">{user.email}</p>
        </div>
      </div>

      <div className="rounded-lg border border-border p-4">
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">
              Display Name
            </label>
            <input
              type="text"
              readOnly
              value={user.displayName}
              className="w-full rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm"
            />
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
        </div>
      </div>
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
            {tokens.map((token, i) => (
              <div
                key={token.id}
                className={`flex items-center justify-between px-4 py-3 ${
                  i < tokens.length - 1 ? "border-b border-border" : ""
                }`}
              >
                <div>
                  <p className="text-sm font-medium">{token.name}</p>
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
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => revokeToken.mutate(token.id)}
                  disabled={revokeToken.isPending}
                  className="text-sm text-destructive transition-colors hover:text-destructive/80"
                >
                  Revoke
                </button>
              </div>
            ))}
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
