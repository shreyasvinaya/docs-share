/**
 * Sandbox attribute for the file-preview iframe that embeds untrusted,
 * user-uploaded content served from the same host as the app/API.
 *
 * SECURITY INVARIANT: this MUST stay `allow-scripts` only and MUST NEVER
 * include `allow-same-origin`. Granting `allow-same-origin` would re-privilege
 * the framed document to the app's real origin, letting its scripts read the
 * host `ds_session` cookie, SAME-ORIGIN access `window.parent`, and issue
 * credentialed `fetch('/api/...')` calls as the victim. With `allow-scripts`
 * alone the document runs in an opaque origin: its own scripts still execute
 * and it can still `postMessage` to the parent with origin `null` (the app
 * registers no `message` listeners, so nothing acts on it), but it is fully
 * isolated from the host session. The server CSP sandboxes the same response
 * as defense in depth (see routes/view.ts).
 */
export const PREVIEW_IFRAME_SANDBOX = "allow-scripts";

/**
 * True when an iframe sandbox token list keeps the framed document in an opaque
 * origin (i.e. does NOT grant `allow-same-origin`). Exposed for tests that
 * assert the preview iframe never escapes its sandbox.
 */
export function isOpaqueOriginSandbox(sandbox: string): boolean {
  return !sandbox
    .split(/\s+/)
    .map((token) => token.trim().toLowerCase())
    .includes("allow-same-origin");
}
