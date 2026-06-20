import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    designation: text("designation"),
    avatarUrl: text("avatar_url"),
    googleId: text("google_id").notNull(),
    githubTokenEncrypted: text("github_token_encrypted"),
    githubTokenUpdatedAt: text("github_token_updated_at"),
    isSysadmin: integer("is_sysadmin", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    uniqueIndex("users_email_idx").on(table.email),
    uniqueIndex("users_google_id_idx").on(table.googleId),
  ]
);

export const teams = sqliteTable(
  "teams",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [uniqueIndex("teams_slug_idx").on(table.slug)]
);

export const teamMembers = sqliteTable(
  "team_members",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "admin", "member", "viewer"] })
      .notNull()
      .default("member"),
    joinedAt: text("joined_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    uniqueIndex("team_members_team_user_idx").on(table.teamId, table.userId),
    index("team_members_user_idx").on(table.userId),
  ]
);

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    ownerType: text("owner_type", { enum: ["user", "team"] }).notNull(),
    ownerUserId: text("owner_user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    ownerTeamId: text("owner_team_id").references(() => teams.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    createdById: text("created_by_id")
      .notNull()
      .references(() => users.id),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    uniqueIndex("projects_user_slug_idx").on(table.ownerUserId, table.slug),
    uniqueIndex("projects_team_slug_idx").on(table.ownerTeamId, table.slug),
  ]
);

export const repos = sqliteTable(
  "repos",
  {
    id: text("id").primaryKey(),
    ownerType: text("owner_type", { enum: ["user", "team"] }).notNull(),
    ownerUserId: text("owner_user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    ownerTeamId: text("owner_team_id").references(() => teams.id, {
      onDelete: "cascade",
    }),
    diskPath: text("disk_path").notNull(),
    headSha: text("head_sha"),
    sizeBytes: integer("size_bytes").default(0),
    lastPushAt: text("last_push_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    uniqueIndex("repos_disk_path_idx").on(table.diskPath),
    uniqueIndex("repos_owner_user_idx").on(table.ownerUserId),
    uniqueIndex("repos_owner_team_idx").on(table.ownerTeamId),
  ]
);

export const apiTokens = sqliteTable(
  "api_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenPrefix: text("token_prefix").notNull(),
    tokenHash: text("token_hash").notNull(),
    scopes: text("scopes").notNull().default("*"),
    expiresAt: text("expires_at"),
    lastUsedAt: text("last_used_at"),
    revokedAt: text("revoked_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    uniqueIndex("api_tokens_hash_idx").on(table.tokenHash),
    index("api_tokens_user_idx").on(table.userId),
  ]
);

export const files = sqliteTable(
  "files",
  {
    id: text("id").primaryKey(),
    repoId: text("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    blobSha: text("blob_sha").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    mimeType: text("mime_type"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("files_repo_path_idx").on(table.repoId, table.path),
    index("files_repo_idx").on(table.repoId),
  ]
);

export const drafts = sqliteTable(
  "drafts",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    storagePath: text("storage_path").notNull(),
    title: text("title").notNull(),
    sourceFilename: text("source_filename").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    contentSha256: text("content_sha256").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    index("drafts_owner_idx").on(table.ownerUserId),
  ]
);

export const shares = sqliteTable(
  "shares",
  {
    id: text("id").primaryKey(),
    repoId: text("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    path: text("path"),
    createdById: text("created_by_id")
      .notNull()
      .references(() => users.id),
    shareType: text("share_type", {
      enum: ["email", "public_link", "team"],
    }).notNull(),
    permission: text("permission", { enum: ["read", "write"] })
      .notNull()
      .default("read"),
    publicToken: text("public_token"),
    linkAccess: text("link_access", { enum: ["public", "org"] }).default(
      "public"
    ),
    orgDomain: text("org_domain"),
    passwordHash: text("password_hash"),
    teamId: text("team_id").references(() => teams.id, {
      onDelete: "cascade",
    }),
    expiresAt: text("expires_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    uniqueIndex("shares_public_token_idx").on(table.publicToken),
    index("shares_repo_idx").on(table.repoId),
    index("shares_created_by_idx").on(table.createdById),
    index("shares_team_idx").on(table.teamId),
  ]
);

export const shareRecipients = sqliteTable(
  "share_recipients",
  {
    id: text("id").primaryKey(),
    shareId: text("share_id")
      .notNull()
      .references(() => shares.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    userId: text("user_id").references(() => users.id),
    acceptedAt: text("accepted_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    uniqueIndex("share_recipients_share_email_idx").on(
      table.shareId,
      table.email
    ),
    index("share_recipients_email_idx").on(table.email),
    index("share_recipients_user_idx").on(table.userId),
  ]
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    index("sessions_user_idx").on(table.userId),
    index("sessions_expires_idx").on(table.expiresAt),
  ]
);

export const githubSyncs = sqliteTable(
  "github_syncs",
  {
    id: text("id").primaryKey(),
    repoId: text("repo_id")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    repoUrl: text("repo_url").notNull(),
    branch: text("branch").notNull().default("main"),
    sourcePath: text("source_path").default(""),
    lastCommitSha: text("last_commit_sha"),
    lastSyncedAt: text("last_synced_at"),
    status: text("status", { enum: ["idle", "syncing", "success", "error"] })
      .notNull()
      .default("idle"),
    error: text("error"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    uniqueIndex("github_syncs_repo_idx").on(table.repoId),
    index("github_syncs_status_idx").on(table.status),
  ]
);

export const viewEvents = sqliteTable(
  "view_events",
  {
    id: text("id").primaryKey(),
    targetType: text("target_type", {
      enum: ["share", "draft", "public"],
    }).notNull(),
    targetId: text("target_id").notNull(),
    viewedAt: text("viewed_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    visitorHash: text("visitor_hash").notNull(),
    referrer: text("referrer"),
    userAgent: text("user_agent"),
  },
  (table) => [
    index("view_events_target_idx").on(table.targetType, table.targetId),
    index("view_events_viewed_at_idx").on(table.viewedAt),
  ]
);

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    metadata: text("metadata"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    index("audit_log_actor_idx").on(table.actorUserId),
    index("audit_log_target_idx").on(table.targetType, table.targetId),
    index("audit_log_created_at_idx").on(table.createdAt),
  ]
);
