/**
 * True when the app is built for the static GitHub Pages "public site" target
 * (`VITE_PUBLIC_SITE=true`). In this mode there is no backing server, so the
 * authenticated app is stripped out and any code that would call the API must
 * be guarded.
 */
export const IS_PUBLIC_SITE = import.meta.env.VITE_PUBLIC_SITE === "true";
