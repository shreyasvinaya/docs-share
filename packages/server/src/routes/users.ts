import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { config } from "../lib/config.js";
import { decryptSecret, encryptSecret, generatePublicToken } from "../lib/crypto.js";
import {
  createGitHubAppInstallUrl,
  createGitHubInstallationToken,
  getGitHubInstallationAccount,
  isGitHubAppConfigured,
} from "../services/githubApp.js";
import type { GitHubCredential } from "../services/githubSync.js";
import type { AppEnv } from "../lib/types.js";

const app = new Hono<AppEnv>();
const GITHUB_APP_STATE_COOKIE = "github_app_state";

app.use("*", requireAuth);

/**
 * GET /me — Return current user profile + their personal repo info.
 */
app.get("/me", async (c) => {
  const userId = c.get("userId");

  const user = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  const repo = await db
    .select()
    .from(schema.repos)
    .where(eq(schema.repos.ownerUserId, userId))
    .get();

  return c.json({
    data: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      designation: user.designation,
      avatarUrl: user.avatarUrl,
      role: user.role,
      createdAt: user.createdAt,
      repo: repo
        ? {
            id: repo.id,
            diskPath: repo.diskPath,
            headSha: repo.headSha,
            sizeBytes: repo.sizeBytes,
            lastPushAt: repo.lastPushAt,
            createdAt: repo.createdAt,
          }
        : null,
    },
  });
});

/**
 * PATCH /me — Update editable profile fields.
 */
app.patch("/me", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json();
  const { displayName, designation } = body;

  const updates: {
    displayName?: string;
    designation?: string | null;
    updatedAt: string;
  } = { updatedAt: new Date().toISOString() };

  if ("displayName" in body) {
    if (
      typeof displayName !== "string" ||
      displayName.trim().length === 0 ||
      displayName.length > 100
    ) {
      return c.json({ error: "Invalid displayName" }, 400);
    }
    updates.displayName = displayName.trim();
  }

  if ("designation" in body) {
    if (
      designation !== null &&
      designation !== undefined &&
      (typeof designation !== "string" || designation.length > 120)
    ) {
      return c.json({ error: "Invalid designation" }, 400);
    }
    updates.designation = designation?.trim() || null;
  }

  if (!updates.displayName && !("designation" in updates)) {
    return c.json({ error: "Invalid displayName" }, 400);
  }

  await db
    .update(schema.users)
    .set(updates)
    .where(eq(schema.users.id, userId))
    .run();

  const user = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();

  return c.json({ data: user });
});

app.get("/me/github-token", async (c) => {
  const userId = c.get("userId");
  const user = await db
    .select({
      githubTokenEncrypted: schema.users.githubTokenEncrypted,
      githubTokenUpdatedAt: schema.users.githubTokenUpdatedAt,
      githubAppInstallationId: schema.users.githubAppInstallationId,
      githubAppAccountLogin: schema.users.githubAppAccountLogin,
      githubAppAccountType: schema.users.githubAppAccountType,
      githubAppConnectedAt: schema.users.githubAppConnectedAt,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();

  if (!user) return c.json({ error: "User not found" }, 404);

  const hasGitHubApp = !!user.githubAppInstallationId;
  const hasPat = !!user.githubTokenEncrypted;

  return c.json({
    data: {
      connected: hasGitHubApp || hasPat,
      connectionType: hasGitHubApp ? "github_app" : hasPat ? "pat" : null,
      configured: isGitHubAppConfigured(),
      updatedAt: user.githubAppConnectedAt ?? user.githubTokenUpdatedAt,
      installationId: user.githubAppInstallationId,
      accountLogin: user.githubAppAccountLogin,
      accountType: user.githubAppAccountType,
    },
  });
});

app.get("/me/github-app/install", async (c) => {
  if (!isGitHubAppConfigured()) {
    return c.json({ error: "GitHub App integration is not configured" }, 503);
  }

  const state = generatePublicToken();
  setCookie(c, GITHUB_APP_STATE_COOKIE, state, {
    httpOnly: true,
    secure: config.APP_URL.startsWith("https"),
    sameSite: "Lax",
    path: "/api/users/me/github-app",
    maxAge: 600,
  });

  return c.redirect(createGitHubAppInstallUrl(state));
});

app.get("/me/github-app/callback", async (c) => {
  const userId = c.get("userId");
  const { installation_id: installationId, state } = c.req.query();
  const storedState = getCookie(c, GITHUB_APP_STATE_COOKIE);
  deleteCookie(c, GITHUB_APP_STATE_COOKIE, {
    path: "/api/users/me/github-app",
  });

  if (!state || !storedState || state !== storedState) {
    return c.json({ error: "Invalid GitHub App state" }, 400);
  }

  if (!installationId || !/^\d+$/.test(installationId)) {
    return c.json({ error: "Missing GitHub App installation" }, 400);
  }

  let account = { login: null as string | null, type: null as string | null };
  if (isGitHubAppConfigured()) {
    try {
      account = await getGitHubInstallationAccount(installationId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: "GitHub App installation lookup failed", details: message }, 502);
    }
  }

  const now = new Date().toISOString();
  await db
    .update(schema.users)
    .set({
      githubAppInstallationId: installationId,
      githubAppAccountLogin: account.login,
      githubAppAccountType: account.type,
      githubAppConnectedAt: now,
      githubTokenEncrypted: null,
      githubTokenUpdatedAt: null,
      updatedAt: now,
    })
    .where(eq(schema.users.id, userId))
    .run();

  return c.redirect("/settings?tab=integrations");
});

app.put("/me/github-token", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{ token?: string }>();
  const token = body.token?.trim();

  if (!token || token.length < 20) {
    return c.json({ error: "A GitHub token is required" }, 400);
  }

  const now = new Date().toISOString();
  await db
    .update(schema.users)
    .set({
      githubTokenEncrypted: encryptSecret(token, config.GITHUB_TOKEN_SECRET),
      githubTokenUpdatedAt: now,
      githubAppInstallationId: null,
      githubAppAccountLogin: null,
      githubAppAccountType: null,
      githubAppConnectedAt: null,
      updatedAt: now,
    })
    .where(eq(schema.users.id, userId))
    .run();

  return c.json({ data: { connected: true, updatedAt: now } });
});

app.delete("/me/github-token", async (c) => {
  const userId = c.get("userId");
  await db
    .update(schema.users)
    .set({
      githubTokenEncrypted: null,
      githubTokenUpdatedAt: null,
      githubAppInstallationId: null,
      githubAppAccountLogin: null,
      githubAppAccountType: null,
      githubAppConnectedAt: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.users.id, userId))
    .run();

  return c.json({ data: { connected: false, updatedAt: null } });
});

export async function getUserGitHubToken(userId: string): Promise<string> {
  const credential = await getUserGitHubCredential(userId);
  return credential.token;
}

export async function getUserGitHubCredential(userId: string): Promise<GitHubCredential> {
  const user = await db
    .select({
      githubTokenEncrypted: schema.users.githubTokenEncrypted,
      githubAppInstallationId: schema.users.githubAppInstallationId,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();

  if (user?.githubAppInstallationId) {
    const installationToken = await createGitHubInstallationToken(
      user.githubAppInstallationId
    );
    return { token: installationToken.token, type: "github_app" };
  }

  if (!user?.githubTokenEncrypted) return { token: "", type: "pat" };
  return {
    token: decryptSecret(user.githubTokenEncrypted, config.GITHUB_TOKEN_SECRET),
    type: "pat",
  };
}

export default app;
