import { Command } from "commander";
import { getClient } from "../lib/api-client.js";
import { resolveTarget } from "../lib/target.js";
import { output, success, info } from "../lib/output.js";
import { CliError, EXIT_CODES } from "../lib/errors.js";
import { getApiUrl } from "../lib/config.js";

export const shareCommand = new Command("share")
  .description("Share files with users or create public links")
  .argument("<target>", 'Target path: "personal/file.md", "team-slug/path"')
  .option("--with <emails...>", "Share with email addresses")
  .option("--write", "Grant write permission (default: read)")
  .option("--public", "Create a public share link")
  .option("--expires <duration>", "Expiration for public links (e.g., 7d, 24h, 30m)")
  .option("--revoke <email>", "Revoke share for a specific email")
  .action(async (targetStr: string, opts: {
    with?: string[];
    write?: boolean;
    public?: boolean;
    expires?: string;
    revoke?: string;
  }) => {
    const client = getClient();
    const target = await resolveTarget(client, targetStr);
    const sharePath = target.subfolder || null;

    if (opts.revoke) {
      await revokeShare(client, target.repoId, sharePath, opts.revoke);
      return;
    }

    if (opts.public) {
      await createPublicLink(client, target.repoId, sharePath, opts.expires);
      return;
    }

    if (opts.with && opts.with.length > 0) {
      await shareWithEmails(
        client,
        target.repoId,
        sharePath,
        opts.with,
        opts.write ? "write" : "read"
      );
      return;
    }

    throw new CliError(
      "Specify --with <email>, --public, or --revoke <email>.",
      EXIT_CODES.VALIDATION_ERROR
    );
  });

async function shareWithEmails(
  client: ReturnType<typeof getClient>,
  repoId: string,
  path: string | null,
  emails: string[],
  permission: "read" | "write"
): Promise<void> {
  const res = await client.post<{ data: unknown }>("/api/shares", {
    repoId,
    path,
    shareType: "email",
    emails,
    permission,
  });

  success(`Shared with ${emails.join(", ")} (${permission})`);
  output(res.data);
}

async function createPublicLink(
  client: ReturnType<typeof getClient>,
  repoId: string,
  path: string | null,
  expiresIn?: string
): Promise<void> {
  const res = await client.post<{
    data: { id: string; publicToken: string; expiresAt: string | null };
  }>("/api/shares", {
    repoId,
    path,
    shareType: "public_link",
    expiresIn,
  });

  const apiUrl = getApiUrl().replace(/\/+$/, "");
  const publicUrl = `${apiUrl}/view/public/${res.data.publicToken}`;

  success("Public link created");
  info(`URL: ${publicUrl}`);
  if (res.data.expiresAt) {
    info(`Expires: ${new Date(res.data.expiresAt).toLocaleString()}`);
  }

  output({
    ...res.data,
    url: publicUrl,
  });
}

async function revokeShare(
  client: ReturnType<typeof getClient>,
  repoId: string,
  path: string | null,
  email: string
): Promise<void> {
  // List shares the user created and find the one matching this repo/path/email
  const sharesRes = await client.get<{ data: Array<{ id: string; repoId: string; path: string | null; shareType: string }> }>(
    "/api/shares"
  );

  const matching = sharesRes.data.filter(
    (s) =>
      s.repoId === repoId &&
      s.path === path &&
      s.shareType === "email"
  );

  if (matching.length === 0) {
    throw new CliError(
      `No email share found for this target to revoke.`,
      EXIT_CODES.NOT_FOUND
    );
  }

  // Delete all matching shares (there should typically be one)
  for (const share of matching) {
    await client.del(`/api/shares/${share.id}`);
  }

  success(`Revoked share for ${email}`);
  output({ revoked: true, email });
}
