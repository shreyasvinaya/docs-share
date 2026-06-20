import { createRateLimiter } from "../middleware/rateLimit.js";
import { config } from "./config.js";

/**
 * Shared rate limiters built from config. Defaults are intentionally generous
 * for normal use while still capping abusive bursts.
 *
 * - `publicRateLimiter` guards anonymous, internet-facing read endpoints
 *   (public shares, public views, draft viewing).
 * - `authRateLimiter` guards credential / token issuing endpoints, which are
 *   the most attractive brute-force targets and therefore tighter.
 */
export const publicRateLimiter = createRateLimiter({
  name: "public",
  limit: config.RATE_LIMIT_PUBLIC_MAX,
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  enabled: config.RATE_LIMIT_ENABLED,
});

export const authRateLimiter = createRateLimiter({
  name: "auth",
  limit: config.RATE_LIMIT_AUTH_MAX,
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  enabled: config.RATE_LIMIT_ENABLED,
});
