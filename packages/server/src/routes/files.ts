import { Hono } from "hono";
import { eq, and, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { requireAuth } from "../middleware/requireAuth.js";
import {
  canReadRepoPath,
  canWriteRepoPath,
} from "../middleware/shareAccess.js";
import { config } from "../lib/config.js";
import {
  normalizeRelativePath,
  redactInternalPaths,
  resolveInside,
} from "../lib/security.js";
import {
  extractRepoFiles,
  indexRepoFiles,
} from "../services/fileExtractor.js";
import {
  commitAndPush,
  runGit,
  spawnWithTimeout,
  withClonedRepo,
} from "../git/gitOps.js";
import { dirname, join } from "path";
import { mkdir, mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";

import type { FileNode } from "@docs-share/shared";
import type { AppEnv } from "../lib/types.js";

const app = new Hono<AppEnv>();

app.use("*", requireAuth);

/**
 * GET /:repoId — List files in repo root (or at ?path= subpath).
 * Returns FileNode[]. Requires auth + read access.
 *
 * Authorization is path-aware: listing a `?path` subtree requires read covering
 * that path, while a repo-root listing (no `?path`) requires a repo-wide read
 * grant (owner, team member, or a whole-repo read share). A path-scoped share
 * therefore cannot list the repo root.
 */
app.get("/:repoId", async (c) => {
  const repoId = c.req.param("repoId");
  const userId = c.get("userId");
  const pathPrefix = c.req.query("path") || "";

  // Authorize the requested target: the given ?path subtree, or the whole repo
  // (empty target) when listing the root. normalizeRelativePath("") === "".
  const requestedTarget = normalizeRelativePath(pathPrefix);
  if (requestedTarget === null) {
    return c.json({ error: "Invalid path" }, 400);
  }
  if (!(await canReadRepoPath(userId, repoId, requestedTarget))) {
    return c.json({ error: "Access denied" }, 403);
  }

  // Build the directory-matching prefix from the NORMALIZED, authorized path
  // (`requestedTarget`), never the raw query input. A non-empty prefix always
  // ends with "/" so it matches only immediate descendants of the directory.
  const normalizedPrefix = requestedTarget ? `${requestedTarget}/` : "";

  // Get all files under this prefix. The prefix is matched with LIKE, whose
  // `%` and `_` are wildcards — so a path containing those characters (e.g.
  // `docs_` or `a%b`) would otherwise match siblings like `docsA` / `axb`.
  // Escape the LIKE metacharacters (`\`, `%`, `_`) and pin the escape char with
  // `ESCAPE '\'` so the prefix matches ONLY its literal characters.
  const allFiles = normalizedPrefix
    ? await db
        .select()
        .from(schema.files)
        .where(
          and(
            eq(schema.files.repoId, repoId),
            sql`${schema.files.path} LIKE ${`${escapeLikePattern(normalizedPrefix)}%`} ESCAPE '\\'`
          )
        )
        .all()
    : await db
        .select()
        .from(schema.files)
        .where(eq(schema.files.repoId, repoId))
        .all();

  // Group into immediate children (files and directories at this level)
  const seen = new Set<string>();
  const nodes: FileNode[] = [];

  for (const file of allFiles) {
    // Get the portion of the path after the prefix
    const relativePath = normalizedPrefix
      ? file.path.slice(normalizedPrefix.length)
      : file.path;

    const slashIndex = relativePath.indexOf("/");

    if (slashIndex === -1) {
      // Direct file at this level
      nodes.push({
        name: relativePath,
        path: file.path,
        type: "file",
        sizeBytes: file.sizeBytes,
        mimeType: file.mimeType,
        updatedAt: file.updatedAt,
      });
    } else {
      // It's inside a subdirectory — emit a directory node
      const dirName = relativePath.slice(0, slashIndex);
      const dirPath = normalizedPrefix + dirName;
      if (!seen.has(dirPath)) {
        seen.add(dirPath);
        nodes.push({
          name: dirName,
          path: dirPath,
          type: "directory",
          sizeBytes: null,
          mimeType: null,
          updatedAt: null,
        });
      }
    }
  }

  return c.json({ data: nodes });
});

/**
 * GET /:repoId/commits — List recent commits for the repo
 * (or at ?path= for a specific file). Uses `git log` subprocess.
 *
 * Authorization is path-aware: a `?path` query authorizes the history of that
 * path (read covering it), while a repo-wide commit log (no `?path`) requires a
 * repo-wide read grant. A path-scoped share cannot read the whole-repo log.
 */
app.get("/:repoId/commits", async (c) => {
  const repoId = c.req.param("repoId");
  const userId = c.get("userId");
  const filePath = c.req.query("path");
  const limit = parseInt(c.req.query("limit") || "20", 10);

  // Authorize the requested target path (or whole repo when none given).
  const requestedTarget = normalizeRelativePath(filePath ?? "");
  if (requestedTarget === null) {
    return c.json({ error: "Invalid path" }, 400);
  }
  if (!(await canReadRepoPath(userId, repoId, requestedTarget))) {
    return c.json({ error: "Access denied" }, 403);
  }

  const repo = await db
    .select()
    .from(schema.repos)
    .where(eq(schema.repos.id, repoId))
    .get();

  if (!repo) {
    return c.json({ error: "Repository not found" }, 404);
  }

  // Build git log command
  const separator = "---COMMIT_SEP---";
  const format = `%H${separator}%s${separator}%an${separator}%ae${separator}%aI`;
  const args = [
    "git",
    "-C",
    repo.diskPath,
    "log",
    `--format=${format}`,
    `-n`,
    String(limit),
  ];

  if (requestedTarget) {
    // Use the NORMALIZED, authorized path (never the raw query input) and run
    // under GIT_LITERAL_PATHSPECS so pathspec magic can't widen the log scope.
    args.push("--", requestedTarget);
  }

  try {
    const proc = await spawnWithTimeout(args, {
      env: { ...process.env, GIT_LITERAL_PATHSPECS: "1" },
    });

    const { stdout, stderr } = proc;

    if (proc.exitCode !== 0) {
      // Likely empty repo with no commits yet
      if (stderr.includes("does not have any commits yet")) {
        return c.json({ data: [] });
      }
      return c.json(
        { error: "Failed to read git log", details: redactInternalPaths(stderr) },
        500
      );
    }

    const commits = stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [sha, message, authorName, authorEmail, date] = line.split(separator);
        return { sha, message, authorName, authorEmail, date };
      });

    return c.json({ data: commits });
  } catch (err) {
    return c.json({ error: "Failed to read git log" }, 500);
  }
});

/**
 * POST /:repoId/upload — Upload file(s) via multipart form.
 * Creates a git commit in the bare repo.
 *
 * Body: multipart with files and optional `path` and `message` fields.
 *
 * Authorization is path-aware: every upload DESTINATION path (the normalized
 * form `path` joined with each file's name) must be covered by a write grant.
 * A path-scoped writer can upload within their path but any destination outside
 * their scope is rejected (403). A repo-wide write (owner / non-viewer team
 * member / whole-repo write share) covers every destination.
 */
app.post("/:repoId/upload", async (c) => {
  const repoId = c.req.param("repoId");
  const userId = c.get("userId");

  const repo = await db
    .select()
    .from(schema.repos)
    .where(eq(schema.repos.id, repoId))
    .get();

  if (!repo) {
    return c.json({ error: "Repository not found" }, 404);
  }

  const user = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  const formData = await c.req.formData();
  const targetPathInput = (formData.get("path") as string) || "";
  const targetPath = normalizeRelativePath(targetPathInput);
  const commitMessage = (formData.get("message") as string) || "Upload files";

  if (targetPath === null) {
    return c.json({ error: "Invalid upload path" }, 400);
  }

  const manifestRaw = formData.get("manifest");
  let manifest: string[] | null = null;
  if (typeof manifestRaw === "string" && manifestRaw.trim()) {
    try {
      const parsed = JSON.parse(manifestRaw);
      if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
        return c.json({ error: "Invalid upload manifest" }, 400);
      }
      manifest = parsed;
    } catch {
      return c.json({ error: "Invalid upload manifest" }, 400);
    }
  }

  // Collect uploaded files
  const uploadedFiles: Array<{ name: string; data: ArrayBuffer }> = [];
  for (const [key, value] of formData.entries()) {
    if (key === "path" || key === "message" || key === "manifest") continue;
    // Bun types declare entries() as [string, string], but at runtime
    // file uploads arrive as File/Blob objects. Use a type assertion to
    // allow the instanceof check.
    const entry = value as unknown;
    if (entry instanceof File) {
      uploadedFiles.push({
        name: entry.name,
        data: await entry.arrayBuffer(),
      });
    }
  }

  if (uploadedFiles.length === 0) {
    return c.json({ error: "No files provided" }, 400);
  }

  if (manifest && manifest.length !== uploadedFiles.length) {
    return c.json({ error: "Upload manifest does not match files" }, 400);
  }

  // Work in a temp directory: clone, add files, commit, push
  const tmpDir = await mkdtemp(join(tmpdir(), "ds-upload-"));

  try {
    const clonePath = join(tmpDir, "repo");

    // Clone the bare repo (timeout-guarded via runGit).
    const cloneResult = await runGit(["clone", repo.diskPath, clonePath]);

    if (cloneResult.exitCode !== 0) {
      // If clone fails because repo is empty, init a new repo and set remote
      await runGit(["init", clonePath]);
      await runGit(["-C", clonePath, "remote", "add", "origin", repo.diskPath]);
    }

    // Configure git user for commit
    await runGit(["-C", clonePath, "config", "user.name", user.displayName]);
    await runGit(["-C", clonePath, "config", "user.email", user.email]);

    // Write files to the clone
    const fileRecords: Array<{ path: string; sizeBytes: number; mimeType: string | null }> = [];

    for (const [index, file] of uploadedFiles.entries()) {
      const requestedPath = manifest?.[index] ?? file.name;
      const normalizedFileName = normalizeRelativePath(requestedPath);
      if (!normalizedFileName) {
        return c.json({ error: `Invalid file path: ${requestedPath}` }, 400);
      }

      const relativePath = targetPath
        ? `${targetPath}/${normalizedFileName}`
        : normalizedFileName;

      // Path-aware write check for THIS destination: a path-scoped writer may
      // only land files inside their scope; anything outside is rejected.
      if (!(await canWriteRepoPath(userId, repoId, relativePath))) {
        return c.json(
          { error: `Access denied for upload path: ${relativePath}` },
          403
        );
      }

      const fileDest = resolveInside(clonePath, relativePath);

      if (!fileDest) {
        return c.json({ error: `Invalid upload path: ${file.name}` }, 400);
      }

      await mkdir(dirname(fileDest), { recursive: true });

      await Bun.write(fileDest, file.data);

      fileRecords.push({
        path: relativePath,
        sizeBytes: file.data.byteLength,
        mimeType: guessMimeType(file.name),
      });
    }

    // Git add all
    await runGit(["-C", clonePath, "add", "-A"]);

    // Git commit
    const commitResult = await runGit([
      "-C",
      clonePath,
      "commit",
      "-m",
      commitMessage,
    ]);

    if (commitResult.exitCode !== 0) {
      const commitOutput = `${commitResult.stdout}\n${commitResult.stderr}`;
      if (
        commitOutput.includes("nothing to commit") ||
        commitOutput.includes("no changes added to commit")
      ) {
        return c.json({
          data: {
            commitSha: repo.headSha,
            filesUploaded: 0,
            message: "No file changes detected",
          },
        });
      }
      return c.json(
        { error: "Git commit failed", details: redactInternalPaths(commitOutput.trim()) },
        500
      );
    }

    // Push back to bare repo
    const pushResult = await runGit(["-C", clonePath, "push", "origin", "HEAD"]);

    if (pushResult.exitCode !== 0) {
      return c.json(
        { error: "Git push failed", details: redactInternalPaths(pushResult.stderr.trim()) },
        500
      );
    }

    // Get the new HEAD sha
    const headSha = (await runGit(["-C", clonePath, "rev-parse", "HEAD"])).stdout.trim();

    // Update repo record
    await db
      .update(schema.repos)
      .set({
        headSha,
        lastPushAt: new Date().toISOString(),
      })
      .where(eq(schema.repos.id, repoId))
      .run();

    await extractRepoFiles(repoId, repo.diskPath, headSha);
    await indexRepoFiles(repoId, repo.diskPath, headSha);

    return c.json({
      data: {
        commitSha: headSha,
        filesUploaded: fileRecords.length,
        message: commitMessage,
      },
    }, 201);
  } finally {
    // Clean up temp directory
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

/**
 * POST /:repoId/restore — Restore a file (or the whole tree) to a prior commit.
 *
 * History is never rewritten: the content at the chosen revision is checked
 * out into a fresh clone of HEAD, staged, and committed as a NEW commit.
 *
 * Body: { sha: string; path?: string }. Omit `path` to restore the full tree.
 *
 * Authorization is path-aware: a whole-repo restore (no `path`) needs a
 * repo-wide write grant, while a path-scoped restore only needs write that
 * covers that path. A holder of only a path-scoped write share therefore cannot
 * restore the whole repo.
 */
app.post("/:repoId/restore", async (c) => {
  const repoId = c.req.param("repoId");
  const userId = c.get("userId");

  const body = await c.req
    .json<{ sha?: string; path?: string }>()
    .catch((): { sha?: string; path?: string } => ({}));
  const sha = typeof body.sha === "string" ? body.sha.trim() : "";
  if (!sha || !/^[0-9a-fA-F]{4,64}$/.test(sha)) {
    return c.json({ error: "A valid commit sha is required" }, 400);
  }

  let targetPath: string | null = "";
  if (body.path !== undefined && body.path !== null && body.path !== "") {
    targetPath = normalizeRelativePath(body.path);
    if (targetPath === null || targetPath === "") {
      return c.json({ error: "Invalid restore path" }, 400);
    }
  }

  // Path-aware write check: whole-repo restore (targetPath "") requires a
  // repo-wide grant; a scoped restore requires write covering that path.
  if (!(await canWriteRepoPath(userId, repoId, targetPath))) {
    return c.json({ error: "Access denied" }, 403);
  }

  const repo = await db
    .select()
    .from(schema.repos)
    .where(eq(schema.repos.id, repoId))
    .get();
  if (!repo) return c.json({ error: "Repository not found" }, 404);

  const user = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();
  if (!user) return c.json({ error: "User not found" }, 404);

  try {
    return await withClonedRepo(
      repo.diskPath,
      { name: user.displayName, email: user.email },
      async (clone) => {
        // Verify the revision exists.
        const verify = await clone.git(["cat-file", "-e", `${sha}^{commit}`]);
        if (verify.exitCode !== 0) {
          return c.json({ error: "Commit not found in repository" }, 404);
        }

        if (targetPath) {
          // Ensure the path existed at that revision.
          const lsRev = await clone.git([
            "ls-tree",
            "-r",
            "--name-only",
            sha,
            "--",
            targetPath,
          ]);
          const matches = lsRev.stdout.trim().split("\n").filter(Boolean);
          if (matches.length === 0) {
            return c.json(
              { error: "Path not found at the requested revision" },
              404
            );
          }
          // `git checkout <sha> -- <path>` stages the prior content over HEAD.
          const checkout = await clone.git(["checkout", sha, "--", targetPath]);
          if (checkout.exitCode !== 0) {
            return c.json(
              { error: "Failed to restore path", details: redactInternalPaths(checkout.stderr.trim()) },
              500
            );
          }
        } else {
          // Restore the entire tree to the prior revision (working tree + index).
          const checkout = await clone.git(["checkout", sha, "--", "."]);
          if (checkout.exitCode !== 0) {
            return c.json(
              { error: "Failed to restore tree", details: redactInternalPaths(checkout.stderr.trim()) },
              500
            );
          }
          // `checkout -- .` does not delete files added after `sha`; remove them
          // so the tree exactly matches the chosen revision.
          await clone.git(["add", "-A"]);
        }

        await clone.git(["add", "-A"]);

        const label = targetPath ? targetPath : "repository";
        const message = `Restore ${label} to ${sha.slice(0, 7)}`;
        const result = await commitAndPush(clone, message);

        if (result.error) {
          return c.json({ error: "Restore failed", details: redactInternalPaths(result.error) }, 500);
        }
        if (!result.headSha) {
          // Nothing changed — already at this content.
          return c.json({
            data: {
              commitSha: repo.headSha,
              path: targetPath || null,
              message: "Already at this version",
            },
          });
        }

        await db
          .update(schema.repos)
          .set({ headSha: result.headSha, lastPushAt: new Date().toISOString() })
          .where(eq(schema.repos.id, repoId))
          .run();

        await extractRepoFiles(repoId, repo.diskPath, result.headSha);
        await indexRepoFiles(repoId, repo.diskPath, result.headSha);

        return c.json({
          data: {
            commitSha: result.headSha,
            path: targetPath || null,
            restoredFrom: sha,
            message,
          },
        });
      }
    );
  } catch {
    return c.json({ error: "Restore failed" }, 500);
  }
});

/**
 * POST /:repoId/copy — Duplicate a file or directory to a new path, committed
 * as a new commit. Optionally targets a different destination repo via
 * `targetRepoId` (write access required on the destination too).
 *
 * Body: { sourcePath: string; targetPath: string; targetRepoId?: string }
 *
 * Authorization is path-aware and uses the SAME helper for every case: READ on
 * the source repo at `sourcePath`, and WRITE on the destination repo (source or
 * `targetRepoId`) at `targetPath`. The cross-repo target uses the identical
 * write check as the same-repo target.
 */
app.post("/:repoId/copy", async (c) => {
  const repoId = c.req.param("repoId");
  const userId = c.get("userId");

  const body = await c.req
    .json<{ sourcePath?: string; targetPath?: string; targetRepoId?: string }>()
    .catch(
      (): {
        sourcePath?: string;
        targetPath?: string;
        targetRepoId?: string;
      } => ({})
    );

  const sourcePath = normalizeRelativePath(body.sourcePath);
  const targetPath = normalizeRelativePath(body.targetPath);
  if (!sourcePath) return c.json({ error: "sourcePath is required" }, 400);
  if (!targetPath) return c.json({ error: "Invalid targetPath" }, 400);

  // Read authorization on the source path of the source repo.
  if (!(await canReadRepoPath(userId, repoId, sourcePath))) {
    return c.json({ error: "Access denied" }, 403);
  }

  const repo = await db
    .select()
    .from(schema.repos)
    .where(eq(schema.repos.id, repoId))
    .get();
  if (!repo) return c.json({ error: "Repository not found" }, 404);

  const user = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();
  if (!user) return c.json({ error: "User not found" }, 404);

  // Resolve destination repo (defaults to source). Authorize WRITE on the
  // destination at the target path with the SAME path-aware helper used for the
  // same-repo case — cross-repo is not special-cased.
  const destRepoId =
    body.targetRepoId && body.targetRepoId !== repoId
      ? body.targetRepoId
      : repoId;

  if (!(await canWriteRepoPath(userId, destRepoId, targetPath))) {
    return c.json({ error: "Access denied to target repository" }, 403);
  }

  let destRepo = repo;
  if (destRepoId !== repoId) {
    const candidate = await db
      .select()
      .from(schema.repos)
      .where(eq(schema.repos.id, destRepoId))
      .get();
    if (!candidate) return c.json({ error: "Target repository not found" }, 404);
    destRepo = candidate;
  }

  try {
    // Read the source blob(s) from the source repo at HEAD.
    const sourceFiles = await readTrackedFiles(repo.diskPath, sourcePath);
    if (sourceFiles.length === 0) {
      return c.json({ error: "Source file or directory not found" }, 404);
    }

    return await withClonedRepo(
      destRepo.diskPath,
      { name: user.displayName, email: user.email },
      async (clone) => {
        for (const file of sourceFiles) {
          // Remap each source path under the new target path.
          const suffix =
            file.path === sourcePath
              ? ""
              : file.path.slice(sourcePath.length + 1);
          const relativeTarget = suffix ? `${targetPath}/${suffix}` : targetPath;
          const dest = resolveInside(clone.dir, relativeTarget);
          if (!dest) {
            return c.json({ error: "Invalid target path" }, 400);
          }
          await mkdir(dirname(dest), { recursive: true });
          await Bun.write(dest, file.data);
        }

        await clone.git(["add", "-A"]);

        const message = `Copy ${sourcePath} to ${targetPath}`;
        const result = await commitAndPush(clone, message);
        if (result.error) {
          return c.json({ error: "Copy failed", details: redactInternalPaths(result.error) }, 500);
        }
        if (!result.headSha) {
          return c.json({ error: "No changes — target already matches" }, 409);
        }

        await db
          .update(schema.repos)
          .set({ headSha: result.headSha, lastPushAt: new Date().toISOString() })
          .where(eq(schema.repos.id, destRepo.id))
          .run();

        await extractRepoFiles(destRepo.id, destRepo.diskPath, result.headSha);
        await indexRepoFiles(destRepo.id, destRepo.diskPath, result.headSha);

        return c.json(
          {
            data: {
              commitSha: result.headSha,
              sourcePath,
              targetPath,
              targetRepoId: destRepo.id,
              filesCopied: sourceFiles.length,
            },
          },
          201
        );
      }
    );
  } catch {
    return c.json({ error: "Copy failed" }, 500);
  }
});

/**
 * DELETE /:repoId — Delete one file or directory path and commit the removal.
 * Query: ?path=<relative-path>
 *
 * Authorization is path-aware: deleting `?path` requires a write grant covering
 * that path. A path-scoped writer can delete within their scope but is denied
 * (403) for any path outside it.
 */
app.delete("/:repoId", async (c) => {
  const repoId = c.req.param("repoId");
  const userId = c.get("userId");
  const requestedPath = c.req.query("path");
  const targetPath = normalizeRelativePath(requestedPath);

  if (!targetPath) {
    return c.json({ error: "path is required" }, 400);
  }

  // Path-aware write check on the deletion target.
  if (!(await canWriteRepoPath(userId, repoId, targetPath))) {
    return c.json({ error: "Access denied" }, 403);
  }

  const repo = await db
    .select()
    .from(schema.repos)
    .where(eq(schema.repos.id, repoId))
    .get();

  if (!repo) {
    return c.json({ error: "Repository not found" }, 404);
  }

  const user = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  const tmpDir = await mkdtemp(join(tmpdir(), "ds-delete-"));

  try {
    const clonePath = join(tmpDir, "repo");
    // runGit forces GIT_LITERAL_PATHSPECS=1 so the user-supplied `targetPath`
    // passed to ls-files / rm below is ALWAYS treated as a literal path, never
    // pathspec magic (e.g. `:(glob)**`), and is timeout-guarded.
    const cloneResult = await runGit(["clone", repo.diskPath, clonePath]);

    if (cloneResult.exitCode !== 0) {
      return c.json({ error: "Repository is empty" }, 404);
    }

    const lsResult = await runGit([
      "-C",
      clonePath,
      "ls-files",
      "--",
      targetPath,
      `${targetPath}/`,
    ]);
    const trackedMatches = lsResult.stdout.trim().split("\n").filter(Boolean);

    if (trackedMatches.length === 0) {
      return c.json({ error: "File or directory not found" }, 404);
    }

    await runGit(["-C", clonePath, "config", "user.name", user.displayName]);
    await runGit(["-C", clonePath, "config", "user.email", user.email]);

    const rmResult = await runGit(["-C", clonePath, "rm", "-r", "--", targetPath]);

    if (rmResult.exitCode !== 0) {
      return c.json(
        { error: "Git rm failed", details: redactInternalPaths(rmResult.stderr.trim()) },
        500
      );
    }

    const commitResult = await runGit([
      "-C",
      clonePath,
      "commit",
      "-m",
      `Delete ${targetPath}`,
    ]);

    if (commitResult.exitCode !== 0) {
      return c.json({
        error: "Git commit failed",
        details: redactInternalPaths(`${commitResult.stdout}\n${commitResult.stderr}`.trim()),
      }, 500);
    }

    const pushResult = await runGit(["-C", clonePath, "push", "origin", "HEAD"]);

    if (pushResult.exitCode !== 0) {
      return c.json(
        { error: "Git push failed", details: redactInternalPaths(pushResult.stderr.trim()) },
        500
      );
    }

    const headSha = (await runGit(["-C", clonePath, "rev-parse", "HEAD"])).stdout.trim();

    await db
      .update(schema.repos)
      .set({
        headSha,
        lastPushAt: new Date().toISOString(),
      })
      .where(eq(schema.repos.id, repoId))
      .run();

    await extractRepoFiles(repoId, repo.diskPath, headSha);
    await indexRepoFiles(repoId, repo.diskPath, headSha);

    return c.json({
      data: {
        commitSha: headSha,
        path: targetPath,
        filesDeleted: trackedMatches.length,
      },
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

/**
 * Read every tracked blob at HEAD whose path equals `path` or lives under it.
 * Returns the list of { path, data } for the matched file(s).
 *
 * Throws if any git invocation exits non-zero, so callers never operate on the
 * output of a failed command. User paths are passed after `--` and run under
 * `GIT_LITERAL_PATHSPECS=1` (see {@link runGit}).
 */
async function readTrackedFiles(
  diskPath: string,
  path: string
): Promise<Array<{ path: string; data: Uint8Array }>> {
  const ls = await runGit([
    "-C",
    diskPath,
    "ls-tree",
    "-r",
    "--name-only",
    "HEAD",
    "--",
    path,
    `${path}/`,
  ]);
  if (ls.exitCode !== 0) {
    throw new Error(`git ls-tree failed: ${ls.stderr.trim()}`);
  }
  const listed = ls.stdout.trim().split("\n").filter(Boolean);

  const files: Array<{ path: string; data: Uint8Array }> = [];
  for (const matched of listed) {
    const showProc = Bun.spawn(
      ["git", "-C", diskPath, "show", `HEAD:${matched}`],
      {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, GIT_LITERAL_PATHSPECS: "1" },
        // Hard timeout so a runaway `git show` can't hang the request.
        timeout: config.GIT_PROCESS_TIMEOUT_MS,
        killSignal: "SIGKILL",
      }
    );
    const data = new Uint8Array(
      await new Response(showProc.stdout).arrayBuffer()
    );
    const showStderr = await new Response(showProc.stderr).text();
    await showProc.exited;
    if ((showProc.exitCode ?? 0) !== 0) {
      throw new Error(`git show failed for ${matched}: ${showStderr.trim()}`);
    }
    files.push({ path: matched, data });
  }
  return files;
}

/**
 * Escape the SQLite LIKE metacharacters in `value` so it matches literally.
 *
 * SQLite LIKE treats `%` (any run) and `_` (any single char) as wildcards. We
 * use `\` as the escape char (paired with an `ESCAPE '\'` clause at the call
 * site), so `\` itself must be escaped first. Without this, a directory prefix
 * like `docs_/` or `a%b/` would match siblings (`docsX/...`, `aZZb/...`).
 */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Simple mime type guesser based on file extension.
 */
function guessMimeType(filename: string): string | null {
  const ext = filename.split(".").pop()?.toLowerCase();
  const mimeMap: Record<string, string> = {
    html: "text/html",
    htm: "text/html",
    css: "text/css",
    js: "application/javascript",
    mjs: "application/javascript",
    json: "application/json",
    ts: "text/typescript",
    tsx: "text/typescript",
    jsx: "text/javascript",
    md: "text/markdown",
    txt: "text/plain",
    svg: "image/svg+xml",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    ico: "image/x-icon",
    pdf: "application/pdf",
    zip: "application/zip",
    woff: "font/woff",
    woff2: "font/woff2",
    ttf: "font/ttf",
    eot: "application/vnd.ms-fontobject",
    xml: "application/xml",
    yaml: "application/yaml",
    yml: "application/yaml",
    toml: "application/toml",
  };
  return ext ? mimeMap[ext] ?? null : null;
}

export default app;
