import { Hono } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { config } from "../lib/config.js";
import { hashToken } from "../lib/crypto.js";
import type { AppEnv } from "../lib/types.js";

const app = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pktLine(data: string): string {
  const len = (data.length + 4).toString(16).padStart(4, "0");
  return `${len}${data}`;
}

/**
 * Parse a Basic Authorization header and validate the token against the
 * apiTokens table. Returns the userId on success, or null on failure.
 */
async function authenticateBasic(
  authHeader: string | undefined,
  requiredScope: "git:read" | "git:write"
): Promise<string | null> {
  if (!authHeader?.startsWith("Basic ")) return null;

  let decoded: string;
  try {
    decoded = atob(authHeader.slice(6));
  } catch {
    return null;
  }

  const colonIndex = decoded.indexOf(":");
  if (colonIndex === -1) return null;

  const password = decoded.slice(colonIndex + 1);
  const tokenHash = hashToken(password);

  const apiToken = await db
    .select()
    .from(schema.apiTokens)
    .where(
      and(
        eq(schema.apiTokens.tokenHash, tokenHash),
        isNull(schema.apiTokens.revokedAt)
      )
    )
    .get();

  if (
    !apiToken ||
    (apiToken.expiresAt && new Date(apiToken.expiresAt) <= new Date()) ||
    !hasScope(apiToken.scopes, requiredScope)
  ) {
    return null;
  }

  return apiToken.userId;
}

function hasScope(scopes: string, requiredScope: "git:read" | "git:write"): boolean {
  const parsedScopes = scopes
    .split(/[,\s]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);

  return (
    parsedScopes.includes("*") ||
    parsedScopes.includes("git:*") ||
    parsedScopes.includes(requiredScope) ||
    (requiredScope === "git:read" && parsedScopes.includes("git:write"))
  );
}

async function resolveAuthorizedRepoPath(
  ownerType: string,
  ownerId: string,
  userId: string,
  permission: "read" | "write"
): Promise<string | null> {
  if (ownerType === "user") {
    const repo = await db
      .select()
      .from(schema.repos)
      .where(eq(schema.repos.ownerUserId, ownerId))
      .get();

    if (!repo || repo.ownerUserId !== userId) return null;
    return repo.diskPath;
  }

  if (ownerType === "team") {
    const team = await db
      .select()
      .from(schema.teams)
      .where(eq(schema.teams.slug, ownerId))
      .get();

    if (!team) return null;

    const membership = await db
      .select()
      .from(schema.teamMembers)
      .where(
        and(
          eq(schema.teamMembers.teamId, team.id),
          eq(schema.teamMembers.userId, userId)
        )
      )
      .get();

    if (!membership) return null;
    if (permission === "write" && membership.role === "viewer") return null;

    const repo = await db
      .select()
      .from(schema.repos)
      .where(eq(schema.repos.ownerTeamId, team.id))
      .get();

    return repo?.diskPath ?? null;
  }

  return null;
}

function unauthorizedGitResponse(): Response {
  return new Response("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="docs-share"' },
  });
}

// ---------------------------------------------------------------------------
// GET /:ownerType/:ownerId/info/refs — Reference discovery
// ---------------------------------------------------------------------------

app.get("/:ownerType/:ownerId/info/refs", async (c) => {
  const { ownerType, ownerId } = c.req.param();
  const service = c.req.query("service");

  if (!service || !["git-upload-pack", "git-receive-pack"].includes(service)) {
    return c.text("Invalid service", 400);
  }

  const requiredScope = service === "git-receive-pack" ? "git:write" : "git:read";
  const userId = await authenticateBasic(c.req.header("Authorization"), requiredScope);
  if (!userId) {
    return unauthorizedGitResponse();
  }

  const repoPath = await resolveAuthorizedRepoPath(
    ownerType,
    ownerId,
    userId,
    service === "git-receive-pack" ? "write" : "read"
  );

  if (!repoPath) {
    return c.text("Repository not found", 404);
  }

  const proc = Bun.spawn([service, "--stateless-rpc", "--advertise-refs", repoPath], {
    stdout: "pipe",
    stderr: "pipe",
    timeout: config.GIT_PROCESS_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });

  const output = await new Response(proc.stdout).arrayBuffer();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    console.error(`${service} advertise-refs failed:`, stderr);
    return c.text("Repository not found", 404);
  }

  // Build the pkt-line advertisement header
  const header = pktLine(`# service=${service}\n`);
  const flushPkt = "0000";

  const body = Buffer.concat([
    Buffer.from(header),
    Buffer.from(flushPkt),
    Buffer.from(output),
  ]);

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": `application/x-${service}-advertisement`,
      "Cache-Control": "no-cache",
    },
  });
});

// ---------------------------------------------------------------------------
// POST /:ownerType/:ownerId/git-upload-pack — Fetch data
// ---------------------------------------------------------------------------

app.post("/:ownerType/:ownerId/git-upload-pack", async (c) => {
  const userId = await authenticateBasic(c.req.header("Authorization"), "git:read");
  if (!userId) {
    return unauthorizedGitResponse();
  }

  const { ownerType, ownerId } = c.req.param();
  const repoPath = await resolveAuthorizedRepoPath(ownerType, ownerId, userId, "read");

  if (!repoPath) {
    return c.text("Repository not found", 404);
  }

  const body = await c.req.arrayBuffer();

  const proc = Bun.spawn(["git-upload-pack", "--stateless-rpc", repoPath], {
    stdin: new Uint8Array(body),
    stdout: "pipe",
    stderr: "pipe",
    timeout: config.GIT_PROCESS_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });

  return new Response(proc.stdout, {
    status: 200,
    headers: {
      "Content-Type": "application/x-git-upload-pack-result",
      "Cache-Control": "no-cache",
    },
  });
});

// ---------------------------------------------------------------------------
// POST /:ownerType/:ownerId/git-receive-pack — Push data
// ---------------------------------------------------------------------------

app.post("/:ownerType/:ownerId/git-receive-pack", async (c) => {
  const userId = await authenticateBasic(c.req.header("Authorization"), "git:write");
  if (!userId) {
    return unauthorizedGitResponse();
  }

  const { ownerType, ownerId } = c.req.param();
  const repoPath = await resolveAuthorizedRepoPath(ownerType, ownerId, userId, "write");

  if (!repoPath) {
    return c.text("Repository not found", 404);
  }

  const body = await c.req.arrayBuffer();

  const proc = Bun.spawn(["git-receive-pack", "--stateless-rpc", repoPath], {
    stdin: new Uint8Array(body),
    stdout: "pipe",
    stderr: "pipe",
    timeout: config.GIT_PROCESS_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });

  return new Response(proc.stdout, {
    status: 200,
    headers: {
      "Content-Type": "application/x-git-receive-pack-result",
      "Cache-Control": "no-cache",
    },
  });
});

export default app;
