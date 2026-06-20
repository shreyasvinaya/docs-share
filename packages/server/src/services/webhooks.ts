import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { generateId } from "../lib/crypto.js";
import { validateWebhookUrl } from "../lib/security.js";
import type { WebhookEvent } from "@docs-share/shared";

const SIGNATURE_HEADER = "X-DocsShare-Signature";
const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 500;
const REQUEST_TIMEOUT_MS = 10_000;

/** Generates a prefixed random secret for signing webhook deliveries. */
export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString("base64url")}`;
}

/**
 * Computes the `sha256=<hex>` HMAC signature of a serialized webhook body using
 * the webhook secret. Sent in the X-DocsShare-Signature header.
 */
export function signWebhookPayload(body: string, secret: string): string {
  const digest = createHmac("sha256", secret).update(body).digest("hex");
  return `sha256=${digest}`;
}

/**
 * Constant-time verification of a webhook signature against an expected body
 * and secret. Tolerates malformed signatures by returning false.
 */
export function verifyWebhookSignature(
  body: string,
  signature: string,
  secret: string
): boolean {
  const expected = signWebhookPayload(body, secret);
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signature);
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}

/** Serializes the standard webhook envelope: { event, deliveredAt, data }. */
export function buildWebhookPayload(
  event: WebhookEvent,
  data: Record<string, unknown>
): string {
  return JSON.stringify({
    event,
    deliveredAt: new Date().toISOString(),
    data,
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface DeliveryOutcome {
  status: "success" | "failed";
  responseCode: number | null;
  attempts: number;
  error: string | null;
}

/**
 * POSTs a signed payload to a single webhook URL with bounded retries and
 * exponential backoff. Returns the final delivery outcome. The URL is
 * re-validated for SSRF safety before each send.
 */
export async function deliverWebhook(params: {
  url: string;
  secret: string;
  body: string;
}): Promise<DeliveryOutcome> {
  const safeUrl = validateWebhookUrl(params.url);
  if (!safeUrl) {
    return {
      status: "failed",
      responseCode: null,
      attempts: 0,
      error: "Webhook URL failed validation",
    };
  }

  const signature = signWebhookPayload(params.body, params.secret);
  let lastError: string | null = null;
  let lastCode: number | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(safeUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "docs-share-webhooks",
          [SIGNATURE_HEADER]: signature,
        },
        body: params.body,
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      lastCode = res.status;
      if (res.ok) {
        return { status: "success", responseCode: res.status, attempts: attempt, error: null };
      }
      lastError = `Webhook responded with ${res.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    if (attempt < MAX_ATTEMPTS) {
      await delay(BACKOFF_BASE_MS * 2 ** (attempt - 1));
    }
  }

  return { status: "failed", responseCode: lastCode, attempts: MAX_ATTEMPTS, error: lastError };
}

function parseEvents(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((e): e is string => typeof e === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Dispatches an event to every active webhook owned by `ownerUserId` that is
 * subscribed to it. Deliveries run in the background (best-effort) and each
 * attempt is logged to webhook_deliveries. Never throws to the caller.
 */
export async function dispatchWebhookEvent(params: {
  ownerUserId: string;
  event: WebhookEvent;
  data: Record<string, unknown>;
}): Promise<void> {
  let webhooks: (typeof schema.webhooks.$inferSelect)[];
  try {
    webhooks = await db
      .select()
      .from(schema.webhooks)
      .where(eq(schema.webhooks.ownerUserId, params.ownerUserId))
      .all();
  } catch (error) {
    console.warn(
      "Webhook lookup failed",
      error instanceof Error ? error.message : String(error)
    );
    return;
  }

  const subscribed = webhooks.filter(
    (hook) => hook.active && parseEvents(hook.events).includes(params.event)
  );
  if (subscribed.length === 0) return;

  const body = buildWebhookPayload(params.event, params.data);

  await Promise.all(
    subscribed.map(async (hook) => {
      try {
        const outcome = await deliverWebhook({
          url: hook.url,
          secret: hook.secret,
          body,
        });
        await db
          .insert(schema.webhookDeliveries)
          .values({
            id: generateId(),
            webhookId: hook.id,
            event: params.event,
            status: outcome.status,
            responseCode: outcome.responseCode,
            attempts: outcome.attempts,
            error: outcome.error,
            createdAt: new Date().toISOString(),
          })
          .run();
      } catch (error) {
        console.warn(
          "Webhook delivery failed",
          error instanceof Error ? error.message : String(error)
        );
      }
    })
  );
}
