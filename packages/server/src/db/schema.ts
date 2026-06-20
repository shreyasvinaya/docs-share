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
    role: text("role", { enum: ["user", "sysadmin"] }).notNull().default("user"),
    githubTokenEncrypted: text("github_token_encrypted"),
    githubTokenUpdatedAt: text("github_token_updated_at"),
    githubAppInstallationId: text("github_app_installation_id"),
    githubAppAccountLogin: text("github_app_account_login"),
    githubAppAccountType: text("github_app_account_type"),
    githubAppConnectedAt: text("github_app_connected_at"),
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

export const siteDataCollections = sqliteTable(
  "site_data_collections",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetType: text("target_type", { enum: ["draft", "repo"] }).notNull(),
    targetId: text("target_id").notNull(),
    collection: text("collection").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    uniqueIndex("site_data_collections_target_name_idx").on(
      table.targetType,
      table.targetId,
      table.collection
    ),
    index("site_data_collections_owner_idx").on(table.ownerUserId),
  ]
);

export const siteDataRecords = sqliteTable(
  "site_data_records",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetType: text("target_type", { enum: ["draft", "repo"] }).notNull(),
    targetId: text("target_id").notNull(),
    collection: text("collection").notNull(),
    fields: text("fields", { mode: "json" })
      .notNull()
      .$type<Record<string, string | number | boolean | null>>(),
    visitorHash: text("visitor_hash"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    index("site_data_owner_idx").on(table.ownerUserId),
    index("site_data_target_idx").on(table.targetType, table.targetId),
    index("site_data_collection_idx").on(
      table.targetType,
      table.targetId,
      table.collection
    ),
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

export const invitations = sqliteTable(
  "invitations",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "admin", "member", "viewer"] })
      .notNull()
      .default("member"),
    token: text("token").notNull(),
    invitedBy: text("invited_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    acceptedAt: text("accepted_at"),
  },
  (table) => [
    uniqueIndex("invitations_token_idx").on(table.token),
    uniqueIndex("invitations_team_email_idx").on(table.teamId, table.email),
    index("invitations_email_idx").on(table.email),
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

export const webhooks = sqliteTable(
  "webhooks",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    secret: text("secret").notNull(),
    events: text("events").notNull().default("[]"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [index("webhooks_owner_idx").on(table.ownerUserId)]
);

export const webhookDeliveries = sqliteTable(
  "webhook_deliveries",
  {
    id: text("id").primaryKey(),
    webhookId: text("webhook_id")
      .notNull()
      .references(() => webhooks.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    status: text("status", { enum: ["success", "failed"] }).notNull(),
    responseCode: integer("response_code"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`),
  },
  (table) => [
    index("webhook_deliveries_webhook_idx").on(table.webhookId),
    index("webhook_deliveries_created_at_idx").on(table.createdAt),
    // Composite (webhook_id, created_at) backs the per-webhook cap's correlated
    // subquery (rank-by-created_at within a webhook), which was previously an
    // O(n^2) scan. See services/webhookCleanup.ts.
    index("webhook_deliveries_webhook_created_idx").on(
      table.webhookId,
      table.createdAt
    ),
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
    status: text("status", {
      enum: ["idle", "syncing", "success", "error", "failed"],
    })
      .notNull()
      .default("idle"),
    error: text("error"),
    retryCount: integer("retry_count").notNull().default(0),
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
    // UA-independent dedupe fingerprint (HMAC over targetType:targetId:ip).
    // Nullable: rows written before migration 0016 have none.
    dedupeKey: text("dedupe_key"),
    referrer: text("referrer"),
  },
  (table) => [
    index("view_events_target_idx").on(table.targetType, table.targetId),
    index("view_events_viewed_at_idx").on(table.viewedAt),
    // Backs the 30-minute dedupe existence check on (targetType, targetId,
    // dedupeKey) within the recent-views window.
    index("view_events_dedupe_idx").on(
      table.targetType,
      table.targetId,
      table.dedupeKey
    ),
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
