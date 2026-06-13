import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { Google, generateState, generateCodeVerifier } from "arctic";
import { eq, and } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { config } from "../lib/config.js";
import { generateId, generateApiToken } from "../lib/crypto.js";
import { isProduction } from "../lib/security.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { createBareRepo } from "../git/repoManager.js";
import type { AppEnv } from "../lib/types.js";

const google = new Google(
  config.GOOGLE_CLIENT_ID,
  config.GOOGLE_CLIENT_SECRET,
  config.GOOGLE_REDIRECT_URI
);

const isSecure = config.APP_URL.startsWith("https");

interface GoogleUserInfo {
  sub: string;
  email: string;
  name: string;
  picture?: string;
  title?: string;
  job_title?: string;
  position?: string;
}

const app = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// GET /google — Redirect to Google OAuth consent screen
// ---------------------------------------------------------------------------
app.get("/google", (c) => {
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const scopes = ["openid", "email", "profile"];
  const url = google.createAuthorizationURL(state, codeVerifier, scopes);

  // Store state and code verifier in cookies for validation on callback
  setCookie(c, "oauth_state", state, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "Lax",
    path: "/",
    maxAge: 600, // 10 minutes
  });

  setCookie(c, "oauth_code_verifier", codeVerifier, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "Lax",
    path: "/",
    maxAge: 600,
  });

  return c.redirect(url.toString());
});

// ---------------------------------------------------------------------------
// GET /google/callback — Handle Google OAuth callback
// ---------------------------------------------------------------------------
app.get("/google/callback", async (c) => {
  const { code, state } = c.req.query();
  const storedState = getCookie(c, "oauth_state");
  const storedCodeVerifier = getCookie(c, "oauth_code_verifier");

  // Clear OAuth cookies immediately
  deleteCookie(c, "oauth_state", { path: "/" });
  deleteCookie(c, "oauth_code_verifier", { path: "/" });

  // Validate state for CSRF protection
  if (!state || !storedState || state !== storedState) {
    return c.json({ error: "Invalid OAuth state" }, 400);
  }

  if (!code || !storedCodeVerifier) {
    return c.json({ error: "Missing authorization code or code verifier" }, 400);
  }

  // Exchange authorization code for tokens
  let tokens;
  try {
    tokens = await google.validateAuthorizationCode(code, storedCodeVerifier);
  } catch {
    return c.json({ error: "Failed to exchange authorization code" }, 400);
  }

  const accessToken = tokens.accessToken();

  // Fetch user profile from Google
  const userInfoRes = await fetch(
    "https://openidconnect.googleapis.com/v1/userinfo",
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!userInfoRes.ok) {
    return c.json({ error: "Failed to fetch user info from Google" }, 500);
  }

  const userInfo: GoogleUserInfo = await userInfoRes.json();
  const googleDesignation =
    userInfo.title ?? userInfo.job_title ?? userInfo.position ?? null;

  // Find or create user by googleId
  let user = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.googleId, userInfo.sub))
    .get();

  let isNewUser = false;

  if (!user) {
    isNewUser = true;
    const userId = generateId();
    const now = new Date().toISOString();

    await db.insert(schema.users).values({
      id: userId,
      email: userInfo.email,
      displayName: userInfo.name,
      designation: googleDesignation,
      avatarUrl: userInfo.picture ?? null,
      googleId: userInfo.sub,
      createdAt: now,
      updatedAt: now,
    });

    user = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .get();
  } else {
    // Update existing user info in case it changed
    await db
      .update(schema.users)
      .set({
        email: userInfo.email,
        displayName: userInfo.name,
        designation: user.designation ?? googleDesignation,
        avatarUrl: userInfo.picture ?? null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.users.id, user.id));
  }

  if (!user) {
    return c.json({ error: "Failed to create user" }, 500);
  }

  // Create personal repo for new users
  if (isNewUser) {
    const repoId = generateId();
    const diskPath = `${config.DATA_DIR}/repos/users/${user.id}.git`;

    await createBareRepo(diskPath);
    await db.insert(schema.repos).values({
      id: repoId,
      ownerType: "user",
      ownerUserId: user.id,
      diskPath,
    });
  }

  // Create session (30-day expiry)
  const sessionId = generateId();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  await db.insert(schema.sessions).values({
    id: sessionId,
    userId: user.id,
    expiresAt,
  });

  // Set session cookie
  setCookie(c, "ds_session", sessionId, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "Lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60, // 30 days in seconds
  });

  return c.redirect(new URL("/app", config.APP_URL).toString());
});

// ---------------------------------------------------------------------------
// POST /dev-login — Username/password fallback for development
// ---------------------------------------------------------------------------
app.post("/dev-login", async (c) => {
  if (isProduction() || process.env.ENABLE_DEV_LOGIN !== "true") {
    return c.json({ error: "Development login is disabled in production" }, 404);
  }

  const { email, password } = await c.req.json<{
    email: string;
    password: string;
  }>();

  if (!email || !password) {
    return c.json({ error: "Email and password required" }, 400);
  }

  // In dev mode, accept any email with password "dev"
  if (password !== "dev") {
    return c.json({ error: "Invalid credentials" }, 401);
  }

  const displayName = email.split("@")[0];
  const googleId = `dev_${email}`;

  let user = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.googleId, googleId))
    .get();

  if (!user) {
    const userId = generateId();
    const now = new Date().toISOString();

    await db.insert(schema.users).values({
      id: userId,
      email,
      displayName,
      designation: null,
      avatarUrl: null,
      googleId,
      createdAt: now,
      updatedAt: now,
    });

    user = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .get();

    // Create personal repo
    if (user) {
      const repoId = generateId();
      const diskPath = `${config.DATA_DIR}/repos/users/${user.id}.git`;
      await createBareRepo(diskPath);
      await db.insert(schema.repos).values({
        id: repoId,
        ownerType: "user",
        ownerUserId: user.id,
        diskPath,
      });
    }
  }

  if (!user) {
    return c.json({ error: "Failed to create user" }, 500);
  }

  const sessionId = generateId();
  const expiresAt = new Date(
    Date.now() + 30 * 24 * 60 * 60 * 1000
  ).toISOString();

  await db.insert(schema.sessions).values({
    id: sessionId,
    userId: user.id,
    expiresAt,
  });

  setCookie(c, "ds_session", sessionId, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "Lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });

  return c.json({ user });
});

// ---------------------------------------------------------------------------
// POST /logout — Delete session and clear cookie
// ---------------------------------------------------------------------------
app.post("/logout", async (c) => {
  const sessionId = getCookie(c, "ds_session");

  if (sessionId) {
    await db
      .delete(schema.sessions)
      .where(eq(schema.sessions.id, sessionId));
  }

  deleteCookie(c, "ds_session", { path: "/" });

  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// GET /session — Return current user (requires auth)
// ---------------------------------------------------------------------------
app.get("/session", requireAuth, async (c) => {
  const userId = c.get("userId");

  const user = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      displayName: schema.users.displayName,
      designation: schema.users.designation,
      avatarUrl: schema.users.avatarUrl,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();

  if (!user) {
    return c.json({ error: "User not found" }, 404);
  }

  return c.json({ user });
});

// ---------------------------------------------------------------------------
// POST /tokens — Create a new API token (requires auth)
// ---------------------------------------------------------------------------
app.post("/tokens", requireAuth, async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{
    name: string;
    scopes?: string;
    expiresIn?: number; // seconds
  }>();

  if (!body.name || typeof body.name !== "string" || body.name.trim() === "") {
    return c.json({ error: "Token name is required" }, 400);
  }

  const { token, hash, prefix } = generateApiToken();
  const tokenId = generateId();
  const now = new Date();

  const expiresAt = body.expiresIn
    ? new Date(now.getTime() + body.expiresIn * 1000).toISOString()
    : null;

  await db.insert(schema.apiTokens).values({
    id: tokenId,
    userId,
    name: body.name.trim(),
    tokenPrefix: prefix,
    tokenHash: hash,
    scopes: body.scopes ?? "*",
    expiresAt,
  });

  return c.json(
    {
      id: tokenId,
      name: body.name.trim(),
      token, // Plaintext token — shown only once
      prefix,
      scopes: body.scopes ?? "*",
      expiresAt,
      createdAt: now.toISOString(),
    },
    201
  );
});

// ---------------------------------------------------------------------------
// GET /tokens — List user's API tokens (masked, requires auth)
// ---------------------------------------------------------------------------
app.get("/tokens", requireAuth, async (c) => {
  const userId = c.get("userId");

  const tokens = await db
    .select({
      id: schema.apiTokens.id,
      name: schema.apiTokens.name,
      tokenPrefix: schema.apiTokens.tokenPrefix,
      scopes: schema.apiTokens.scopes,
      expiresAt: schema.apiTokens.expiresAt,
      lastUsedAt: schema.apiTokens.lastUsedAt,
      createdAt: schema.apiTokens.createdAt,
    })
    .from(schema.apiTokens)
    .where(eq(schema.apiTokens.userId, userId))
    .all();

  return c.json({ tokens });
});

// ---------------------------------------------------------------------------
// DELETE /tokens/:tokenId — Delete an API token (requires auth)
// ---------------------------------------------------------------------------
app.delete("/tokens/:tokenId", requireAuth, async (c) => {
  const userId = c.get("userId");
  const tokenId = c.req.param("tokenId");

  const existing = await db
    .select()
    .from(schema.apiTokens)
    .where(
      and(
        eq(schema.apiTokens.id, tokenId),
        eq(schema.apiTokens.userId, userId)
      )
    )
    .get();

  if (!existing) {
    return c.json({ error: "Token not found" }, 404);
  }

  await db
    .delete(schema.apiTokens)
    .where(eq(schema.apiTokens.id, tokenId));

  return c.json({ ok: true });
});

export default app;
