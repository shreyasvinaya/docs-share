import { useState } from "react";
import {
  useCreateWebhook,
  useDeleteWebhook,
  useUpdateWebhook,
  useWebhooks,
} from "@/hooks/use-webhooks";
import { webhookEvents, type WebhookEvent } from "@patra/shared";

const EVENT_LABELS: Record<WebhookEvent, string> = {
  "share.created": "Share created",
  "share.revoked": "Share revoked",
  "github_sync.completed": "GitHub sync completed",
};

export function WebhooksPanel() {
  const { data: webhooks, isLoading } = useWebhooks();
  const createWebhook = useCreateWebhook();
  const updateWebhook = useUpdateWebhook();
  const deleteWebhook = useDeleteWebhook();

  const [url, setUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<WebhookEvent[]>([
    "share.created",
  ]);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const toggleEvent = (event: WebhookEvent) => {
    setSelectedEvents((current) =>
      current.includes(event)
        ? current.filter((value) => value !== event)
        : [...current, event],
    );
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || selectedEvents.length === 0) return;
    createWebhook.mutate(
      { url: url.trim(), events: selectedEvents },
      {
        onSuccess: (data) => {
          setNewSecret(data.secret);
          setUrl("");
          setSelectedEvents(["share.created"]);
        },
      },
    );
  };

  const handleCopy = () => {
    if (!newSecret) return;
    navigator.clipboard.writeText(newSecret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Webhooks</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Receive a signed POST when your shares change or a GitHub sync
          completes. Each request includes an{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">
            X-Patra-Signature
          </code>{" "}
          HMAC-SHA256 header you can verify with your endpoint secret.
        </p>
      </div>

      <form onSubmit={handleCreate} className="rounded-lg border border-border p-4">
        <h3 className="mb-3 text-sm font-semibold">Add a webhook</h3>
        <div className="space-y-4">
          <div>
            <label htmlFor="webhook-url" className="mb-1 block text-sm font-medium">
              Endpoint URL
            </label>
            <input
              id="webhook-url"
              type="url"
              placeholder="https://hooks.example.com/patra"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Must be a public https URL. Private and loopback addresses are
              rejected.
            </p>
          </div>
          <fieldset>
            <legend className="mb-1 block text-sm font-medium">Events</legend>
            <div className="space-y-1">
              {webhookEvents.map((event) => (
                <label key={event} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedEvents.includes(event)}
                    onChange={() => toggleEvent(event)}
                    className="h-4 w-4 rounded border-border"
                  />
                  {EVENT_LABELS[event]}
                </label>
              ))}
            </div>
          </fieldset>
          {createWebhook.isError && (
            <p className="text-sm text-destructive">
              {createWebhook.error instanceof Error
                ? createWebhook.error.message
                : "Could not create webhook."}
            </p>
          )}
          <button
            type="submit"
            disabled={
              createWebhook.isPending ||
              !url.trim() ||
              selectedEvents.length === 0
            }
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {createWebhook.isPending ? "Adding..." : "Add webhook"}
          </button>
        </div>
      </form>

      {newSecret && (
        <div className="rounded-lg border border-border bg-muted/50 p-4">
          <p className="mb-2 text-sm font-medium text-foreground">
            Signing secret created. Copy it now -- you will not see it again.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={newSecret}
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

      <div>
        <h3 className="mb-3 text-sm font-semibold">Your webhooks</h3>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading webhooks...</p>
        ) : webhooks && webhooks.length > 0 ? (
          <div className="rounded-lg border border-border">
            {webhooks.map((webhook, i) => (
              <div
                key={webhook.id}
                className={`flex items-start justify-between gap-4 px-4 py-3 ${
                  i < webhooks.length - 1 ? "border-b border-border" : ""
                }`}
              >
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm">{webhook.url}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {webhook.events.map((event) => (
                      <span
                        key={event}
                        className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                      >
                        {EVENT_LABELS[event] ?? event}
                      </span>
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {webhook.active ? "Active" : "Paused"} · Added{" "}
                    {new Date(webhook.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      updateWebhook.mutate({
                        id: webhook.id,
                        data: { active: !webhook.active },
                      })
                    }
                    disabled={updateWebhook.isPending}
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                  >
                    {webhook.active ? "Pause" : "Resume"}
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteWebhook.mutate(webhook.id)}
                    disabled={deleteWebhook.isPending}
                    className="text-sm text-destructive transition-colors hover:text-destructive/80 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-border px-4 py-8 text-center text-sm text-muted-foreground">
            No webhooks yet. Add one above.
          </p>
        )}
      </div>
    </div>
  );
}
