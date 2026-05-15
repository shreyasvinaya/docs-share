import { Hono } from "hono";
import { join } from "path";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { hashToken } from "../lib/crypto.js";
import { config } from "../lib/config.js";
import type { AppEnv } from "../lib/types.js";

const app = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveRepoPath(ownerType: string, ownerId: string): string {
  return join(config.DATA_DIR, "repos", `${ownerType}s`, `${ownerId}.git`);
}

function pktLine(data: string): string {
  const len = (data.length + 4).toString(16).padStart(4, "0");
  return `${len}${data}`;
}

/**
 * Parse a Basic Authorization header and validate the token against the
 * apiTokens table. Returns the userId on success, or null on failure.
 */
async function authenticateBasic(
  authHeader: string | undefined
): Promise<string | null> {
  if (!authHeader?.startsWith("Basic ")) return null;

  const decoded = atob(authHeader.slice(6));
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
    (apiToken.expiresAt && new Date(apiToken.expiresAt) <= new Date())
  ) {
    return null;
  }

  return apiToken.userId;
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

  // receive-pack (push) requires authentication
  if (service === "git-receive-pack") {
    const userId = await authenticateBasic(c.req.header("Authorization"));
    if (!userId) {
      return new Response("Authentication required", {
        status: 401,
        headers: { "WWW-Authenticate": 'Basic realm="docs-share"' },
      });
    }
  }

  const repoPath = resolveRepoPath(ownerType, ownerId);

  const proc = Bun.spawn([service, "--stateless-rpc", "--advertise-refs", repoPath], {
    stdout: "pipe",
    stderr: "pipe",
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
  const { ownerType, ownerId } = c.req.param();
  const repoPath = resolveRepoPath(ownerType, ownerId);

  const body = await c.req.arrayBuffer();

  const proc = Bun.spawn(["git-upload-pack", "--stateless-rpc", repoPath], {
    stdin: new Uint8Array(body),
    stdout: "pipe",
    stderr: "pipe",
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
  const userId = await authenticateBasic(c.req.header("Authorization"));
  if (!userId) {
    return new Response("Authentication required", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="docs-share"' },
    });
  }

  const { ownerType, ownerId } = c.req.param();
  const repoPath = resolveRepoPath(ownerType, ownerId);

  const body = await c.req.arrayBuffer();

  const proc = Bun.spawn(["git-receive-pack", "--stateless-rpc", repoPath], {
    stdin: new Uint8Array(body),
    stdout: "pipe",
    stderr: "pipe",
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
