import { Hono } from "hono";
import { eq, and, like } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { checkAccess } from "../middleware/shareAccess.js";
import { generateId } from "../lib/crypto.js";
import { config } from "../lib/config.js";
import { join } from "path";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";

import type { FileNode } from "@docs-share/shared";
import type { AppEnv } from "../lib/types.js";

const app = new Hono<AppEnv>();

app.use("*", requireAuth);

/**
 * GET /:repoId — List files in repo root (or at ?path= subpath).
 * Returns FileNode[]. Requires auth + read access.
 */
app.get("/:repoId", checkAccess("read"), async (c) => {
  const repoId = c.req.param("repoId");
  const pathPrefix = c.req.query("path") || "";

  // Normalize: ensure prefix ends with / if non-empty, for directory matching
  const normalizedPrefix = pathPrefix
    ? pathPrefix.endsWith("/")
      ? pathPrefix
      : pathPrefix + "/"
    : "";

  // Get all files under this prefix
  const allFiles = normalizedPrefix
    ? await db
        .select()
        .from(schema.files)
        .where(
          and(
            eq(schema.files.repoId, repoId),
            like(schema.files.path, `${normalizedPrefix}%`)
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
 */
app.get("/:repoId/commits", checkAccess("read"), async (c) => {
  const repoId = c.req.param("repoId");
  const filePath = c.req.query("path");
  const limit = parseInt(c.req.query("limit") || "20", 10);

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

  if (filePath) {
    args.push("--", filePath);
  }

  try {
    const proc = Bun.spawn(args, {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    await proc.exited;

    if (proc.exitCode !== 0) {
      // Likely empty repo with no commits yet
      if (stderr.includes("does not have any commits yet")) {
        return c.json({ data: [] });
      }
      return c.json({ error: "Failed to read git log", details: stderr }, 500);
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
 * Requires auth + write access.
 */
app.post("/:repoId/upload", checkAccess("write"), async (c) => {
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
  const targetPath = (formData.get("path") as string) || "";
  const commitMessage = (formData.get("message") as string) || "Upload files";

  // Collect uploaded files
  const uploadedFiles: Array<{ name: string; data: ArrayBuffer }> = [];
  for (const [key, value] of formData.entries()) {
    if (key === "path" || key === "message") continue;
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

  // Work in a temp directory: clone, add files, commit, push
  const tmpDir = await mkdtemp(join(tmpdir(), "ds-upload-"));

  try {
    const clonePath = join(tmpDir, "repo");

    // Clone the bare repo
    const cloneProc = Bun.spawn(["git", "clone", repo.diskPath, clonePath], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await cloneProc.exited;

    if (cloneProc.exitCode !== 0) {
      // If clone fails because repo is empty, init a new repo and set remote
      const initProc = Bun.spawn(["git", "init", clonePath], {
        stdout: "pipe",
        stderr: "pipe",
      });
      await initProc.exited;

      const remoteProc = Bun.spawn(
        ["git", "-C", clonePath, "remote", "add", "origin", repo.diskPath],
        { stdout: "pipe", stderr: "pipe" }
      );
      await remoteProc.exited;
    }

    // Configure git user for commit
    const configNameProc = Bun.spawn(
      ["git", "-C", clonePath, "config", "user.name", user.displayName],
      { stdout: "pipe", stderr: "pipe" }
    );
    await configNameProc.exited;

    const configEmailProc = Bun.spawn(
      ["git", "-C", clonePath, "config", "user.email", user.email],
      { stdout: "pipe", stderr: "pipe" }
    );
    await configEmailProc.exited;

    // Write files to the clone
    const fileRecords: Array<{ path: string; sizeBytes: number; mimeType: string | null }> = [];

    for (const file of uploadedFiles) {
      const fileDest = targetPath
        ? join(clonePath, targetPath, file.name)
        : join(clonePath, file.name);

      // Ensure parent directory exists
      const parentDir = fileDest.substring(0, fileDest.lastIndexOf("/"));
      const mkdirProc = Bun.spawn(["mkdir", "-p", parentDir], {
        stdout: "pipe",
        stderr: "pipe",
      });
      await mkdirProc.exited;

      await Bun.write(fileDest, file.data);

      const relativePath = targetPath
        ? `${targetPath}/${file.name}`
        : file.name;

      fileRecords.push({
        path: relativePath,
        sizeBytes: file.data.byteLength,
        mimeType: guessMimeType(file.name),
      });
    }

    // Git add all
    const addProc = Bun.spawn(["git", "-C", clonePath, "add", "-A"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await addProc.exited;

    // Git commit
    const commitProc = Bun.spawn(
      ["git", "-C", clonePath, "commit", "-m", commitMessage],
      { stdout: "pipe", stderr: "pipe" }
    );
    await commitProc.exited;

    if (commitProc.exitCode !== 0) {
      const stderr = await new Response(commitProc.stderr).text();
      return c.json({ error: "Git commit failed", details: stderr }, 500);
    }

    // Push back to bare repo
    const pushProc = Bun.spawn(
      ["git", "-C", clonePath, "push", "origin", "HEAD"],
      { stdout: "pipe", stderr: "pipe" }
    );
    await pushProc.exited;

    if (pushProc.exitCode !== 0) {
      const stderr = await new Response(pushProc.stderr).text();
      return c.json({ error: "Git push failed", details: stderr }, 500);
    }

    // Get the new HEAD sha
    const revParseProc = Bun.spawn(
      ["git", "-C", clonePath, "rev-parse", "HEAD"],
      { stdout: "pipe", stderr: "pipe" }
    );
    const headSha = (await new Response(revParseProc.stdout).text()).trim();
    await revParseProc.exited;

    // Update repo record
    await db
      .update(schema.repos)
      .set({
        headSha,
        lastPushAt: new Date().toISOString(),
      })
      .where(eq(schema.repos.id, repoId))
      .run();

    // Upsert file records in the DB
    const now = new Date().toISOString();
    for (const fr of fileRecords) {
      const existing = await db
        .select()
        .from(schema.files)
        .where(
          and(
            eq(schema.files.repoId, repoId),
            eq(schema.files.path, fr.path)
          )
        )
        .get();

      if (existing) {
        await db
          .update(schema.files)
          .set({
            sizeBytes: fr.sizeBytes,
            mimeType: fr.mimeType,
            blobSha: headSha,
            updatedAt: now,
          })
          .where(eq(schema.files.id, existing.id))
          .run();
      } else {
        await db
          .insert(schema.files)
          .values({
            id: generateId(),
            repoId,
            path: fr.path,
            blobSha: headSha,
            sizeBytes: fr.sizeBytes,
            mimeType: fr.mimeType,
            updatedAt: now,
          })
          .run();
      }
    }

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
