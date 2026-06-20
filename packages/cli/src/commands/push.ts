import { Command } from "commander";
import { statSync, readdirSync, readFileSync } from "node:fs";
import { join, basename, relative } from "node:path";
import { getClient } from "../lib/api-client.js";
import { resolveTarget } from "../lib/target.js";
import { output, success, info, error } from "../lib/output.js";
import { FileNotFoundError, CliError, EXIT_CODES } from "../lib/errors.js";
import { getApiUrl, getMaxUploadBytes, getMaxUploadFiles } from "../lib/config.js";

/** Directory names that should never be uploaded by a `push .`. */
const SKIPPED_DIRS = new Set(["node_modules", ".git"]);

export const pushCommand = new Command("push")
  .description("Upload files to a Patra target")
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

    // Guard against accidentally uploading an entire project: cap the file count
    // and total byte size before reading anything into memory.
    enforceUploadLimits(filesToUpload, getMaxUploadFiles(), getMaxUploadBytes());

    // Build multipart form
    const formData = new FormData();

    if (target.subfolder) {
      formData.append("path", target.subfolder);
    }
    formData.append("message", opts.message);
    formData.append(
      "manifest",
      JSON.stringify(filesToUpload.map((file) => file.relativeName))
    );

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

export interface FileEntry {
  absolutePath: string;
  relativeName: string;
  sizeBytes: number;
}

export function collectFiles(localPath: string, isDirectory: boolean): FileEntry[] {
  if (!isDirectory) {
    return [
      {
        absolutePath: localPath,
        relativeName: basename(localPath),
        sizeBytes: safeSize(localPath),
      },
    ];
  }

  const entries: FileEntry[] = [];
  walkDir(localPath, localPath, entries);
  return entries;
}

function safeSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function walkDir(rootDir: string, currentDir: string, entries: FileEntry[]): void {
  const items = readdirSync(currentDir, { withFileTypes: true });

  for (const item of items) {
    const fullPath = join(currentDir, item.name);

    // Skip hidden files/dirs (dotfiles) and well-known heavy directories so a
    // stray `patra push .` doesn't upload an entire project tree.
    if (item.name.startsWith(".")) continue;
    if (item.isDirectory() && SKIPPED_DIRS.has(item.name)) continue;

    if (item.isDirectory()) {
      walkDir(rootDir, fullPath, entries);
    } else if (item.isFile()) {
      entries.push({
        absolutePath: fullPath,
        relativeName: relative(rootDir, fullPath),
        sizeBytes: safeSize(fullPath),
      });
    }
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Throw a clear, actionable error if the set of files to upload exceeds the
 * configured file-count or total-byte limits.
 */
export function enforceUploadLimits(
  files: FileEntry[],
  maxFiles: number,
  maxBytes: number
): void {
  if (files.length > maxFiles) {
    throw new CliError(
      `Refusing to upload ${files.length} files (limit ${maxFiles}). ` +
        `Narrow the path or raise PATRA_MAX_UPLOAD_FILES.`,
      EXIT_CODES.VALIDATION_ERROR
    );
  }

  const totalBytes = files.reduce((sum, f) => sum + f.sizeBytes, 0);
  if (totalBytes > maxBytes) {
    throw new CliError(
      `Refusing to upload ${formatBytes(totalBytes)} total (limit ${formatBytes(maxBytes)}). ` +
        `Narrow the path or raise PATRA_MAX_UPLOAD_BYTES.`,
      EXIT_CODES.VALIDATION_ERROR
    );
  }
}
