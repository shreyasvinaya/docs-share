import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireScope } from "../middleware/requireScope.js";
import { config } from "../lib/config.js";
import { decryptSecret, encryptSecret, generatePublicToken } from "../lib/crypto.js";
import {
  createGitHubAppInstallUrl,
  createGitHubInstallationToken,
  exchangeGitHubUserCode,
  getGitHubInstallationAccount,
  isGitHubAppConfigured,
  isGitHubAppOAuthConfigured,
  userCanAccessInstallation,
} from "../services/githubApp.js";
import type { GitHubCredential } from "../services/githubSync.js";
import type { AppEnv } from "../lib/types.js";

const app = new Hono<AppEnv>();
const GITHUB_APP_STATE_COOKIE = "github_app_state";

app.use("*", requireAuth);
// API-token least-privilege is applied PER ROUTE here (not via a blanket
// router-level `requireScopeByMethod("user")`) so each route needs EXACTLY ONE
// scope. The GitHub App install/callback are GETs but mutate the account's
// connection, so they require `user:write` ONLY — a blanket read gate would
// have forced them to need BOTH `user:read` and `user:write`, locking out a
// legitimate `user:write` token. Read GETs require `user:read`; write routes
// require `user:write`. Session auth is unaffected (requireScope only enforces
// for api_token).

/**
 * GET /me — Return current user profile + their personal repo info.
 */
app.get("/me", requireScope("user:read"), async (c) => {
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
app.patch("/me", requireScope("user:write"), async (c) => {
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

app.get("/me/github-token", requireScope("user:read"), async (c) => {
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

// These two are GET (OAuth redirect flow) but mutate the account's GitHub
// connection, so they require `user:write` ONLY (not `user:read`). They carry a
// single explicit per-route scope so a `user:write` token is sufficient.
app.get("/me/github-app/install", requireScope("user:write"), async (c) => {
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

app.get("/me/github-app/callback", requireScope("user:write"), async (c) => {
  const userId = c.get("userId");
  const { installation_id: installationId, state, code } = c.req.query();
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

  if (!isGitHubAppOAuthConfigured()) {
    return c.json(
      {
        error:
          "GitHub App connection is unavailable: set GITHUB_APP_CLIENT_ID and GITHUB_APP_CLIENT_SECRET to verify installation ownership.",
      },
      503
    );
  }

  if (!code) {
    return c.json(
      {
        error:
          "Missing GitHub authorization code. Enable 'Request user authorization (OAuth) during installation' on the GitHub App.",
      },
      400
    );
  }

  let userToken: string;
  try {
    userToken = await exchangeGitHubUserCode(code);
  } catch {
    return c.json({ error: "Failed to verify GitHub authorization." }, 502);
  }

  let authorized = false;
  try {
    authorized = await userCanAccessInstallation(userToken, installationId);
  } catch {
    return c.json({ error: "GitHub installation verification failed." }, 502);
  }

  if (!authorized) {
    return c.json({ error: "You are not authorized for this GitHub App installation." }, 403);
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

app.put("/me/github-token", requireScope("user:write"), async (c) => {
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

app.delete("/me/github-token", requireScope("user:write"), async (c) => {
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
