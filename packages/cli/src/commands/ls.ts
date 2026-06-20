import { Command } from "commander";
import { getClient } from "../lib/api-client.js";
import { resolveTarget } from "../lib/target.js";
import { output, formatTable, isInteractive } from "../lib/output.js";
import type { FileNode, Team, Share } from "@patra/shared";

export const lsCommand = new Command("ls")
  .description("List files, teams, or shared items")
  .argument("[target]", 'Target to list: "personal", "personal/subfolder", "team-slug/path"')
  .option("--teams", "List teams you belong to")
  .option("--shared", "List files shared with you")
  .action(async (target: string | undefined, opts: { teams?: boolean; shared?: boolean }) => {
    const client = getClient();

    if (opts.teams) {
      await listTeams(client);
      return;
    }

    if (opts.shared) {
      await listShared(client);
      return;
    }

    // Default: list files in target (defaults to personal root)
    const resolvedTarget = target || "personal";
    await listFiles(client, resolvedTarget);
  });

async function listFiles(client: ReturnType<typeof getClient>, targetStr: string): Promise<void> {
  const target = await resolveTarget(client, targetStr);

  const pathQuery = target.subfolder ? `?path=${encodeURIComponent(target.subfolder)}` : "";
  const res = await client.get<{ data: FileNode[] }>(
    `/api/files/${target.repoId}${pathQuery}`
  );

  const files = res.data;

  if (isInteractive()) {
    if (files.length === 0) {
      process.stdout.write("No files found.\n");
    } else {
      process.stdout.write(
        formatTable(
          ["TYPE", "NAME", "SIZE", "UPDATED"],
          files.map((f) => [
            f.type === "directory" ? "dir" : "file",
            f.name,
            f.sizeBytes != null ? formatSize(f.sizeBytes) : "-",
            f.updatedAt ? new Date(f.updatedAt).toLocaleDateString() : "-",
          ])
        ) + "\n"
      );
    }
  } else {
    output(files);
  }
}

async function listTeams(client: ReturnType<typeof getClient>): Promise<void> {
  const res = await client.get<{
    data: Array<Team & { role: string }>;
  }>("/api/teams");

  const teams = res.data;

  if (isInteractive()) {
    if (teams.length === 0) {
      process.stdout.write("No teams found.\n");
    } else {
      process.stdout.write(
        formatTable(
          ["SLUG", "NAME", "ROLE", "CREATED"],
          teams.map((t) => [
            t.slug,
            t.name,
            t.role,
            new Date(t.createdAt).toLocaleDateString(),
          ])
        ) + "\n"
      );
    }
  } else {
    output(teams);
  }
}

async function listShared(client: ReturnType<typeof getClient>): Promise<void> {
  const res = await client.get<{
    data: Array<Share & { recipientId: string; acceptedAt: string | null }>;
  }>("/api/shares/incoming");

  const items = res.data;

  if (isInteractive()) {
    if (items.length === 0) {
      process.stdout.write("No shared items found.\n");
    } else {
      process.stdout.write(
        formatTable(
          ["TYPE", "PATH", "PERMISSION", "EXPIRES"],
          items.map((s) => [
            s.shareType,
            s.path ?? "(root)",
            s.permission,
            s.expiresAt ? new Date(s.expiresAt).toLocaleDateString() : "never",
          ])
        ) + "\n"
      );
    }
  } else {
    output(items);
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
