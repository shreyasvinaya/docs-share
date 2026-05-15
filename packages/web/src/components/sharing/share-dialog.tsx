import { useState } from "react";
import {
  useCreateEmailShare,
  useCreatePublicLink,
} from "@/hooks/use-sharing";
import { cn } from "@/lib/utils";
import type { SharePermission } from "@docs-share/shared";

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
  const [tab, setTab] = useState<"email" | "link">("email");
  const [emails, setEmails] = useState("");
  const [permission, setPermission] = useState<SharePermission>("read");
  const [publicUrl, setPublicUrl] = useState<string | null>(null);

  const emailShare = useCreateEmailShare();
  const publicLink = useCreatePublicLink();

  if (!open) return null;

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
          onClose();
        },
      },
    );
  };

  const handlePublicLink = () => {
    publicLink.mutate(
      { repoId, path: path ?? undefined },
      {
        onSuccess: (data) => {
          if (data.publicToken) {
            const url = `${window.location.origin}/view/${repoId}/${path ?? ""}?token=${data.publicToken}`;
            setPublicUrl(url);
          }
        },
      },
    );
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
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Email
          </button>
          <button
            type="button"
            onClick={() => setTab("link")}
            className={cn(
              "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              tab === "link"
                ? "bg-background shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Public Link
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

        {tab === "link" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Anyone with the link can view this file.
            </p>
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
                <p className="text-xs text-green-600">Link created.</p>
              </div>
            ) : (
              <button
                type="button"
                onClick={handlePublicLink}
                disabled={publicLink.isPending}
                className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {publicLink.isPending ? "Creating..." : "Create Public Link"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
