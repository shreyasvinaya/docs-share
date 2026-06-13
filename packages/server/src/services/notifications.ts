export interface EmailShareNotification {
  to: string;
  subject: string;
  html: string;
}

export interface ShareNotificationContext {
  appUrl: string;
  sharerName: string;
  resourceLabel: string;
}

export interface SlackShareNotificationContext extends ShareNotificationContext {
  shareType: "email" | "team" | "public_link";
  permission: "read" | "write";
}

export function buildEmailShareNotification(
  params: ShareNotificationContext & { recipientEmail: string }
): EmailShareNotification {
  const sharedUrl = `${params.appUrl.replace(/\/+$/, "")}/shared`;
  const subject = `${params.sharerName} shared ${params.resourceLabel} with you`;

  return {
    to: params.recipientEmail,
    subject,
    html: [
      `<p>${escapeHtml(params.sharerName)} shared <strong>${escapeHtml(params.resourceLabel)}</strong> with you.</p>`,
      `<p><a href="${escapeHtml(sharedUrl)}">Open shared documents</a></p>`,
    ].join(""),
  };
}

export function buildSlackShareNotification(params: SlackShareNotificationContext): string {
  const sharedUrl = `${params.appUrl.replace(/\/+$/, "")}/shared`;
  return `${params.sharerName} shared ${params.resourceLabel} via ${params.shareType} (${params.permission}). ${sharedUrl}`;
}

export async function sendShareEmailNotifications(params: {
  apiKey: string;
  from: string;
  messages: EmailShareNotification[];
}): Promise<void> {
  if (!params.apiKey || !params.from || params.messages.length === 0) return;

  await Promise.all(
    params.messages.map(async (message) => {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${params.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: params.from,
          to: message.to,
          subject: message.subject,
          html: message.html,
        }),
      });
      if (!res.ok) {
        throw new Error(`Email notification failed: ${res.status} ${res.statusText}`);
      }
    })
  );
}

export async function sendSlackNotification(params: {
  webhookUrl: string;
  text: string;
}): Promise<void> {
  if (!params.webhookUrl) return;

  const res = await fetch(params.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: params.text }),
  });
  if (!res.ok) {
    throw new Error(`Slack notification failed: ${res.status} ${res.statusText}`);
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
