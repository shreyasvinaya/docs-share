import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { request as httpsRequest } from "https";
import { request as httpRequest, type IncomingMessage } from "http";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { generateId } from "../lib/crypto.js";
import {
  isProduction,
  resolveAndValidateHost,
  validateWebhookUrl,
  type DnsLookupAll,
  type ResolvedAddress,
} from "../lib/security.js";
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

interface PinnedRequest {
  url: URL;
  /** The DNS-validated IP the socket MUST connect to (anti-rebinding pin). */
  pinnedAddress: ResolvedAddress;
  headers: Record<string, string>;
  body: string;
}

interface PinnedResponse {
  statusCode: number;
}

/**
 * Low-level single HTTP(S) request that PINS the TCP connection to a
 * pre-validated IP. We connect DIRECTLY to the validated IP literal
 * (`pinnedAddress`) by passing it as the request `hostname`, so there is no DNS
 * resolution at connect time and the socket can only reach the exact IP we
 * validated against the SSRF guard — closing the validate-then-connect TOCTOU
 * (DNS rebinding). Critically we do NOT rely on an agent `lookup`: Bun's HTTP
 * client (the production runtime) ignores `agent.lookup` and re-resolves the
 * hostname itself, so the only reliable pin is to target the IP directly. The
 * original Host header and TLS SNI/`servername` are preserved so the receiving
 * server routes correctly and the TLS certificate is validated against the real
 * hostname, not the IP. Injectable for tests.
 */
export type PinnedRequestSender = (
  req: PinnedRequest
) => Promise<PinnedResponse>;

export const defaultSendPinnedRequest: PinnedRequestSender = (req) => {
  return new Promise<PinnedResponse>((resolvePromise, reject) => {
    const isHttps = req.url.protocol === "https:";
    const port = req.url.port ? Number(req.url.port) : isHttps ? 443 : 80;
    // Preserve the original Host (incl. a non-default port) for routing and as
    // the TLS cert-validation target.
    const hostHeader = req.url.port
      ? `${req.url.hostname}:${req.url.port}`
      : req.url.hostname;

    let settled = false;
    const finish = (value: PinnedResponse) => {
      if (settled) return;
      settled = true;
      resolvePromise(value);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const options = {
      // Connect to the VALIDATED IP literal — no DNS at connect time, so Bun
      // cannot re-resolve to a rebound/internal address.
      hostname: req.pinnedAddress.address,
      port,
      path: `${req.url.pathname}${req.url.search}`,
      method: "POST",
      headers: { ...req.headers, Host: hostHeader },
      // TLS SNI + cert validation against the real hostname (not the IP).
      servername: isHttps ? req.url.hostname : undefined,
      // No pooled/keep-alive socket could ever bypass the IP target.
      agent: false as const,
      timeout: REQUEST_TIMEOUT_MS,
    };

    const onResponse = (res: IncomingMessage) => {
      // Reject redirects (parity with the previous redirect:"error").
      const code = res.statusCode ?? 0;
      if (code >= 300 && code < 400) {
        res.resume();
        fail(new Error(`Webhook redirect not allowed (status ${code})`));
        return;
      }
      // Drain and discard the body; we only care about the status code.
      res.resume();
      res.on("end", () => finish({ statusCode: code }));
      res.on("error", fail);
    };

    const clientReq = isHttps
      ? httpsRequest(options, onResponse)
      : httpRequest(options, onResponse);

    clientReq.on("timeout", () => {
      clientReq.destroy(new Error("Webhook request timed out"));
    });
    clientReq.on("error", fail);
    clientReq.write(req.body);
    clientReq.end();
  });
};

/**
 * POSTs a signed payload to a single webhook URL with bounded retries and
 * exponential backoff. Returns the final delivery outcome.
 *
 * SSRF / DNS-rebinding hardening before every send:
 *  1. URL-shape validation (validateWebhookUrl) — http(s) only, no creds, and
 *     no IP-literal internal hosts.
 *  2. https-only is enforced in production; http is permitted in dev.
 *  3. DNS is resolved and EVERY resolved address is checked against the
 *     private/loopback guard (resolveAndValidateHost) — a public hostname that
 *     resolves to an internal IP is rejected and no request is sent.
 *  4. The connection is PINNED to a validated resolved IP via a custom agent
 *     lookup, so the IP that was validated is the IP actually connected to
 *     (closes the validate-then-connect TOCTOU). The Host header / TLS SNI is
 *     preserved for certificate validation.
 *
 * `lookupAll` and `sendRequest` are injectable for testing.
 */
export async function deliverWebhook(
  params: {
    url: string;
    secret: string;
    body: string;
  },
  deps: {
    lookupAll?: DnsLookupAll;
    sendRequest?: PinnedRequestSender;
    isProductionEnv?: boolean;
  } = {}
): Promise<DeliveryOutcome> {
  const sendRequest = deps.sendRequest ?? defaultSendPinnedRequest;
  const inProduction = deps.isProductionEnv ?? isProduction();

  const safeUrl = validateWebhookUrl(params.url);
  if (!safeUrl) {
    return {
      status: "failed",
      responseCode: null,
      attempts: 0,
      error: "Webhook URL failed validation",
    };
  }

  const parsedUrl = new URL(safeUrl);

  // Enforce https in production; allow http only in dev.
  if (inProduction && parsedUrl.protocol !== "https:") {
    return {
      status: "failed",
      responseCode: null,
      attempts: 0,
      error: "Webhook URL must use https in production",
    };
  }

  // Resolve DNS and validate ALL addresses, then pin to the first validated IP.
  // Done before sending so a hostname that resolves to a private IP never gets
  // a connection attempt.
  let pinnedAddress: ResolvedAddress;
  try {
    const addresses = await resolveAndValidateHost(
      parsedUrl.hostname,
      deps.lookupAll
    );
    pinnedAddress = addresses[0];
  } catch (error) {
    return {
      status: "failed",
      responseCode: null,
      attempts: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const signature = signWebhookPayload(params.body, params.secret);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "docs-share-webhooks",
    [SIGNATURE_HEADER]: signature,
  };
  let lastError: string | null = null;
  let lastCode: number | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      // Re-resolve + re-validate + re-pin on EVERY attempt: a low-TTL attacker
      // domain can flip to an internal IP between attempts, so each send pins to
      // a freshly validated address (a private result throws and fails closed).
      const addresses = await resolveAndValidateHost(
        parsedUrl.hostname,
        deps.lookupAll
      );
      pinnedAddress = addresses[0];
      const res = await sendRequest({
        url: parsedUrl,
        pinnedAddress,
        headers,
        body: params.body,
      });

      lastCode = res.statusCode;
      if (res.statusCode >= 200 && res.statusCode < 300) {
        return {
          status: "success",
          responseCode: res.statusCode,
          attempts: attempt,
          error: null,
        };
      }
      lastError = `Webhook responded with ${res.statusCode}`;
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

/**
 * Fire-and-forget wrapper around {@link dispatchWebhookEvent}. Schedules
 * delivery WITHOUT awaiting it so the request handler can return immediately:
 * a slow or hanging webhook endpoint (up to MAX_ATTEMPTS x REQUEST_TIMEOUT_MS)
 * must never delay the user-facing response.
 *
 * Call this AFTER the originating DB mutation has committed. All errors —
 * including any thrown synchronously while scheduling — are caught and logged
 * internally so nothing ever propagates into the request path.
 *
 * Returns the in-flight delivery promise so tests can optionally await
 * completion; production callers ignore it.
 */
export function scheduleWebhookDispatch(params: {
  ownerUserId: string;
  event: WebhookEvent;
  data: Record<string, unknown>;
}): Promise<void> {
  let pending: Promise<void>;
  try {
    pending = dispatchWebhookEvent(params);
  } catch (error) {
    // dispatchWebhookEvent is async and should not throw synchronously, but
    // guard anyway so a programming error can never reach the request path.
    console.warn(
      "Webhook dispatch scheduling failed",
      error instanceof Error ? error.message : String(error)
    );
    return Promise.resolve();
  }

  return pending.catch((error) => {
    console.warn(
      "Webhook dispatch failed",
      error instanceof Error ? error.message : String(error)
    );
  });
}
