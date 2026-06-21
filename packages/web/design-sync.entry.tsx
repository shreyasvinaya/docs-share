// Scoped design-sync bundle entry for Patra (committed sync input).
//
// @patra/web is a Vite *app*, not a component library — it ships no library
// dist entry, and synth-from-src would pull in data/router-coupled pages (and
// Vite-only `?raw`/`?url` imports) that can't bundle standalone. This barrel
// exports exactly the components scoped for Claude Design (the presentational
// pieces that render without app context); the design system itself is carried
// by the theme tokens + compiled stylesheet.
//
// It lives at the package root (not under .design-sync/) on purpose: the
// converter derives PKG_DIR by walking up from cfg.entry, so the entry must sit
// inside packages/web for @patra/web to resolve. Not part of the app build
// (tsconfig `include` is ["src"], and nothing imports it).
export { EmptyState } from "@/components/common/empty-state";
export { UserAvatar } from "@/components/common/user-avatar";
export { PublicThemeControl } from "@/components/layout/public-theme-control";
