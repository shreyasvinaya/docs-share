import { Hono } from "hono";
import { desc, eq, and } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireScope } from "../middleware/requireScope.js";
import { generateId } from "../lib/crypto.js";
import { validateWebhookUrl } from "../lib/security.js";
import { generateWebhookSecret } from "../services/webhooks.js";
import { webhookEvents } from "@patra/shared";
import type { AppEnv } from "../lib/types.js";

const app = new Hono<AppEnv>();

const ALLOWED_EVENTS = new Set<string>(webhookEvents);

type WebhookRow = typeof schema.webhooks.$inferSelect;

interface WebhookResponse {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

function parseEvents(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((e): e is string => typeof e === "string") : [];
  } catch {
    return [];
  }
}

// Never exposes the raw secret after creation.
export function toWebhookResponse(row: WebhookRow): WebhookResponse {
  return {
    id: row.id,
    url: row.url,
    events: parseEvents(row.events),
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeEvents(input: unknown): string[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const events = [...new Set(input)];
  for (const event of events) {
    if (typeof event !== "string" || !ALLOWED_EVENTS.has(event)) return null;
  }
  return events as string[];
}

app.post("/", requireAuth, requireScope("webhook:write"), async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const safeUrl = validateWebhookUrl((body as { url?: unknown }).url as string);
  if (!safeUrl) {
    return c.json(
      { error: "url must be a public http(s) URL (private/loopback hosts are not allowed)" },
      400
    );
  }

  const events = normalizeEvents((body as { events?: unknown }).events);
  if (!events) {
    return c.json(
      { error: `events must be a non-empty array of: ${[...ALLOWED_EVENTS].join(", ")}` },
      400
    );
  }

  const active = (body as { active?: unknown }).active;
  const secret = generateWebhookSecret();
  const id = generateId();
  const now = new Date().toISOString();

  await db
    .insert(schema.webhooks)
    .values({
      id,
      ownerUserId: userId,
      url: safeUrl,
      secret,
      events: JSON.stringify(events),
      active: active === undefined ? true : Boolean(active),
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const row = await db
    .select()
    .from(schema.webhooks)
    .where(eq(schema.webhooks.id, id))
    .get();

  // Secret is returned exactly once, on creation.
  return c.json({ data: { ...toWebhookResponse(row!), secret } }, 201);
});

app.get("/", requireAuth, requireScope("webhook:read"), async (c) => {
  const userId = c.get("userId");
  const rows = await db
    .select()
    .from(schema.webhooks)
    .where(eq(schema.webhooks.ownerUserId, userId))
    .orderBy(desc(schema.webhooks.createdAt));

  return c.json({ data: rows.map(toWebhookResponse) });
});

async function getOwnedWebhook(id: string, userId: string): Promise<WebhookRow | undefined> {
  return db
    .select()
    .from(schema.webhooks)
    .where(and(eq(schema.webhooks.id, id), eq(schema.webhooks.ownerUserId, userId)))
    .get();
}

app.patch("/:webhookId", requireAuth, requireScope("webhook:write"), async (c) => {
  const userId = c.get("userId");
  const webhookId = c.req.param("webhookId");
  const existing = await getOwnedWebhook(webhookId, userId);
  if (!existing) return c.json({ error: "Webhook not found" }, 404);

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return c.json({ error: "Invalid request body" }, 400);
  }

  const updates: Partial<typeof schema.webhooks.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  };

  if ("url" in body) {
    const safeUrl = validateWebhookUrl((body as { url?: unknown }).url as string);
    if (!safeUrl) {
      return c.json(
        { error: "url must be a public http(s) URL (private/loopback hosts are not allowed)" },
        400
      );
    }
    updates.url = safeUrl;
  }

  if ("events" in body) {
    const events = normalizeEvents((body as { events?: unknown }).events);
    if (!events) {
      return c.json(
        { error: `events must be a non-empty array of: ${[...ALLOWED_EVENTS].join(", ")}` },
        400
      );
    }
    updates.events = JSON.stringify(events);
  }

  if ("active" in body) {
    updates.active = Boolean((body as { active?: unknown }).active);
  }

  await db
    .update(schema.webhooks)
    .set(updates)
    .where(eq(schema.webhooks.id, webhookId))
    .run();

  const row = await db
    .select()
    .from(schema.webhooks)
    .where(eq(schema.webhooks.id, webhookId))
    .get();

  return c.json({ data: toWebhookResponse(row!) });
});

app.delete("/:webhookId", requireAuth, requireScope("webhook:write"), async (c) => {
  const userId = c.get("userId");
  const webhookId = c.req.param("webhookId");
  const existing = await getOwnedWebhook(webhookId, userId);
  if (!existing) return c.json({ error: "Webhook not found" }, 404);

  await db.delete(schema.webhooks).where(eq(schema.webhooks.id, webhookId)).run();

  return c.json({ data: { deleted: true } });
});

export default app;
