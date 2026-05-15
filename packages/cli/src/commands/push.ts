import { Command } from "commander";
import { statSync, readdirSync, readFileSync } from "node:fs";
import { join, basename, relative } from "node:path";
import { getClient } from "../lib/api-client.js";
import { resolveTarget } from "../lib/target.js";
import { output, success, info, error } from "../lib/output.js";
import { FileNotFoundError, CliError, EXIT_CODES } from "../lib/errors.js";
import { getApiUrl } from "../lib/config.js";

export const pushCommand = new Command("push")
  .description("Upload files to a docs-share target")
  .argument("<path>", "Local file or directory to upload")
  .requiredOption("--to <target>", 'Target: "personal", "personal/subfolder", "team-slug", "team-slug/subfolder"')
  .option("--message <msg>", "Commit message", "Upload via CLI")
  .option("--share <email...>", "Share with email addresses after upload")
  .option("--share-team <team...>", "Share with teams after upload")
  .action(async (localPath: string, opts: {
    to: string;
    message: string;
    share?: string[];
    shareTeam?: string[];
  }) => {
    // Validate local path exists
    let stat;
    try {
      stat = statSync(localPath);
    } catch {
      throw new FileNotFoundError(localPath);
    }

    const client = getClient();
    const target = await resolveTarget(client, opts.to);

    // Collect files to upload
    const filesToUpload = collectFiles(localPath, stat.isDirectory());

    if (filesToUpload.length === 0) {
      throw new CliError("No files found to upload.", EXIT_CODES.FILE_NOT_FOUND);
    }

    // Build multipart form
    const formData = new FormData();

    if (target.subfolder) {
      formData.append("path", target.subfolder);
    }
    formData.append("message", opts.message);

    for (const file of filesToUpload) {
      const content = readFileSync(file.absolutePath);
      const blob = new Blob([content]);
      formData.append("file", blob, file.relativeName);
    }

    // Upload
    const uploadRes = await client.upload<{
      data: {
        commitSha: string;
        filesUploaded: number;
        message: string;
      };
    }>(`/api/files/${target.repoId}/upload`, formData);

    success(
      `Pushed ${uploadRes.data.filesUploaded} file(s) to ${target.label}${target.subfolder ? "/" + target.subfolder : ""}`
    );
    info(`Commit: ${uploadRes.data.commitSha.slice(0, 8)}`);

    // Build preview URLs
    const apiUrl = getApiUrl();
    const baseUrl = apiUrl.replace(/\/+$/, "");
    const previewUrls = filesToUpload.map((f) => {
      const fullPath = target.subfolder
        ? `${target.subfolder}/${f.relativeName}`
        : f.relativeName;
      return {
        file: f.relativeName,
        url: `${baseUrl}/view/${target.repoId}/${fullPath}`,
      };
    });

    for (const pv of previewUrls) {
      info(`  ${pv.file} -> ${pv.url}`);
    }

    // Share if requested
    const shareResults: unknown[] = [];

    if (opts.share && opts.share.length > 0) {
      try {
        const shareRes = await client.post("/api/shares", {
          repoId: target.repoId,
          path: target.subfolder || null,
          shareType: "email",
          emails: opts.share,
          permission: "read",
        });
        success(`Shared with ${opts.share.join(", ")}`);
        shareResults.push(shareRes);
      } catch (err) {
        error(`Failed to share: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (opts.shareTeam && opts.shareTeam.length > 0) {
      for (const teamSlug of opts.shareTeam) {
        try {
          // Resolve team slug to ID
          const teamsRes = await client.get<{
            data: Array<{ id: string; slug: string }>;
          }>("/api/teams");
          const t = teamsRes.data.find((tm) => tm.slug === teamSlug);
          if (!t) {
            error(`Team "${teamSlug}" not found, skipping.`);
            continue;
          }

          const shareRes = await client.post("/api/shares", {
            repoId: target.repoId,
            path: target.subfolder || null,
            shareType: "team",
            teamId: t.id,
            permission: "read",
          });
          success(`Shared with team "${teamSlug}"`);
          shareResults.push(shareRes);
        } catch (err) {
          error(`Failed to share with team "${teamSlug}": ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    output({
      commit: uploadRes.data.commitSha,
      filesUploaded: uploadRes.data.filesUploaded,
      target: `${target.label}${target.subfolder ? "/" + target.subfolder : ""}`,
      previewUrls,
      shares: shareResults.length > 0 ? shareResults : undefined,
    });
  });

interface FileEntry {
  absolutePath: string;
  relativeName: string;
}

function collectFiles(localPath: string, isDirectory: boolean): FileEntry[] {
  if (!isDirectory) {
    return [
      {
        absolutePath: localPath,
        relativeName: basename(localPath),
      },
    ];
  }

  const entries: FileEntry[] = [];
  walkDir(localPath, localPath, entries);
  return entries;
}

function walkDir(rootDir: string, currentDir: string, entries: FileEntry[]): void {
  const items = readdirSync(currentDir, { withFileTypes: true });

  for (const item of items) {
    const fullPath = join(currentDir, item.name);

    // Skip hidden files/dirs
    if (item.name.startsWith(".")) continue;

    if (item.isDirectory()) {
      walkDir(rootDir, fullPath, entries);
    } else if (item.isFile()) {
      entries.push({
        absolutePath: fullPath,
        relativeName: relative(rootDir, fullPath),
      });
    }
  }
}
