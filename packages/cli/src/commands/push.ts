import { Command } from "commander";
import { statSync, readdirSync, readFileSync } from "node:fs";
import { join, basename, relative } from "node:path";
import { getClient } from "../lib/api-client.js";
import { resolveTarget, validatePathSegments } from "../lib/target.js";
import { output, success, info, error, warn } from "../lib/output.js";
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
    const collected = collectFiles(localPath, stat.isDirectory());
    const filesToUpload = collected.files;

    // A stat failure means we can't bound the file's size against the upload
    // cap, so refuse rather than risk reading an unbounded file. (Symlinks are
    // skipped, not errored — but we must not silently lose data.)
    if (collected.statFailures.length > 0) {
      throw new CliError(
        `Could not read the size of ${collected.statFailures.length} file(s); ` +
          `refusing to upload. First: ${collected.statFailures[0]}`,
        EXIT_CODES.FILE_NOT_FOUND
      );
    }

    // Surface skipped symlinks so the silent omission can't cause unnoticed data
    // loss. We deliberately do not follow them.
    if (collected.skippedSymlinks > 0) {
      warn(
        `Skipped ${collected.skippedSymlinks} symlinked entr${
          collected.skippedSymlinks === 1 ? "y" : "ies"
        } (symlinks are never followed). They were NOT uploaded.`
      );
    }

    if (filesToUpload.length === 0) {
      throw new CliError("No files found to upload.", EXIT_CODES.FILE_NOT_FOUND);
    }

    // Defense in depth: reject any relative name that could traverse out of the
    // target dir or smuggle control chars before building the form.
    for (const file of filesToUpload) {
      validatePathSegments(file.relativeName, "file name");
    }

    // Guard against accidentally uploading an entire project: cap the file count
    // and total byte size before reading anything into memory.
    const maxBytes = getMaxUploadBytes();
    enforceUploadLimits(filesToUpload, getMaxUploadFiles(), maxBytes);

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

    // Re-check the cumulative byte total against the cap while reading, using the
    // actual bytes read. The collect-time sizes are a point-in-time snapshot; a
    // file that grew or changed between stat and read could otherwise blow the
    // bound. Abort with a clear error if the real total exceeds the cap.
    let bytesRead = 0;
    for (const file of filesToUpload) {
      const content = readFileSync(file.absolutePath);
      bytesRead += content.byteLength;
      assertWithinReadCap(bytesRead, maxBytes);
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

    // Build preview URLs. Each path segment is percent-encoded so names with
    // spaces, `?`, `#`, etc. produce valid (non-garbled) links. The path
    // separators between segments are preserved.
    const apiUrl = getApiUrl();
    const baseUrl = apiUrl.replace(/\/+$/, "");
    const encodePath = (p: string): string =>
      p.split("/").map(encodeURIComponent).join("/");
    const previewUrls = filesToUpload.map((f) => {
      const fullPath = target.subfolder
        ? `${target.subfolder}/${f.relativeName}`
        : f.relativeName;
      return {
        file: f.relativeName,
        url: `${baseUrl}/view/${encodeURIComponent(target.repoId)}/${encodePath(fullPath)}`,
      };
    });

    for (const pv of previewUrls) {
      info(`  ${pv.file} -> ${pv.url}`);
    }

    // Share if requested. The upload already succeeded, so a failed share is not
    // fatal — but it must not pass silently: track failures and set a non-zero
    // exit code at the end so scripts can detect "uploaded but share failed".
    const shareResults: unknown[] = [];
    let shareFailed = false;

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
        shareFailed = true;
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
            shareFailed = true;
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
          shareFailed = true;
          error(`Failed to share with team "${teamSlug}": ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    // A requested share that failed is a partial success: surface it via the exit
    // code (without throwing, since the upload itself succeeded).
    if (shareFailed) {
      process.exitCode = EXIT_CODES.NETWORK_ERROR;
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

export interface CollectResult {
  files: FileEntry[];
  /** Number of symlinked files/dirs skipped (we never follow symlinks). */
  skippedSymlinks: number;
  /** Paths whose size we couldn't stat at collect time. */
  statFailures: string[];
}

export function collectFiles(
  localPath: string,
  isDirectory: boolean
): CollectResult {
  if (!isDirectory) {
    const size = tryStatSize(localPath);
    if (size === undefined) {
      return { files: [], skippedSymlinks: 0, statFailures: [localPath] };
    }
    return {
      files: [
        {
          absolutePath: localPath,
          relativeName: basename(localPath),
          sizeBytes: size,
        },
      ],
      skippedSymlinks: 0,
      statFailures: [],
    };
  }

  const result: CollectResult = {
    files: [],
    skippedSymlinks: 0,
    statFailures: [],
  };
  walkDir(localPath, localPath, result);
  return result;
}

/**
 * Stat a path for its size. Returns undefined (rather than a misleading 0) when
 * the stat fails, so callers can skip/error instead of silently counting an
 * unbounded file as zero bytes against the upload cap.
 */
function tryStatSize(path: string): number | undefined {
  try {
    return statSync(path).size;
  } catch {
    return undefined;
  }
}

function walkDir(
  rootDir: string,
  currentDir: string,
  result: CollectResult
): void {
  const items = readdirSync(currentDir, { withFileTypes: true });

  for (const item of items) {
    const fullPath = join(currentDir, item.name);

    // Never follow symlinks (a symlink could point outside the tree, or loop).
    // Count them so the caller can warn about the silent skip.
    if (item.isSymbolicLink()) {
      result.skippedSymlinks++;
      continue;
    }

    // Skip hidden files/dirs (dotfiles) and well-known heavy directories so a
    // stray `patra push .` doesn't upload an entire project tree.
    if (item.name.startsWith(".")) continue;
    if (item.isDirectory() && SKIPPED_DIRS.has(item.name)) continue;

    if (item.isDirectory()) {
      walkDir(rootDir, fullPath, result);
    } else if (item.isFile()) {
      const size = tryStatSize(fullPath);
      if (size === undefined) {
        // Couldn't determine the size — don't count it as 0 (which would let it
        // slip past the byte cap and still be read). Record it as a failure.
        result.statFailures.push(fullPath);
        continue;
      }
      result.files.push({
        absolutePath: fullPath,
        relativeName: relative(rootDir, fullPath),
        sizeBytes: size,
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

/**
 * Re-check the running byte total against the cap during the read loop. The
 * collect-time size snapshot can go stale (a file that grew/changed between the
 * stat and the read), so this defends the bound with the bytes actually read.
 */
export function assertWithinReadCap(bytesReadSoFar: number, maxBytes: number): void {
  if (bytesReadSoFar > maxBytes) {
    throw new CliError(
      `Upload exceeded the ${formatBytes(maxBytes)} limit while reading files ` +
        `(a file changed or grew since it was scanned). ` +
        `Re-run, or raise PATRA_MAX_UPLOAD_BYTES.`,
      EXIT_CODES.VALIDATION_ERROR
    );
  }
}
