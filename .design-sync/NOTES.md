# Patra — design-sync notes

Repo-specific gotchas for syncing Patra to Claude Design. Read before re-syncing.

## What this sync is

- **`@patra/web` is a Vite _app_, not a component library** — no library `exports`/`dist`,
  no shipped `.d.ts`. The "design system" is the **theme** (Tailwind v4 `@theme` tokens:
  cream/teal/gold palette + the Fraunces / Hanken Grotesk / JetBrains Mono type system) plus a
  few presentational components.
- **Scope = tokens + 3 components**: `EmptyState`, `UserAvatar` (common), `PublicThemeControl`
  (layout). The other 10 components are data/router/store-coupled page shells and widgets
  (AppSidebar, ShareDialog, GithubSyncPanel, FileTree, WebhooksPanel, …) — deliberately excluded;
  they can't render statically without a mocked react-query/router/zustand stack.

## Build mechanics (why the config looks unusual)

- **Scoped entry barrel**: `packages/web/design-sync.entry.tsx` (committed) re-exports just the 3
  scoped components. `cfg.entry` points at it. It MUST live inside `packages/web` — the converter
  derives `PKG_DIR` by walking **up** from `cfg.entry`, so an entry under `.design-sync/` (repo
  root) resolves `PKG_DIR` to the repo root (wrong: version 0.0.0, no src, no tsconfig).
- **Self-symlink** (gitignored, recreate on fresh clone): the converter resolves `@patra/web`
  inside `--node-modules`. Create an **absolute** link so resolution is unambiguous:
  `ln -sfn "$PWD/packages/web" packages/web/node_modules/@patra/web`
- **Compiled CSS** (`cfg.cssEntry = .design-sync-styles.css`, gitignored build artifact): the app
  ships no library stylesheet; component utilities only exist in the **compiled** Tailwind output.
  Regenerate each sync:
  ```sh
  bun run --filter @patra/web build
  CSS=$(ls -t packages/web/dist/assets/index-*.css | head -1)
  { echo "@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400..700&family=Hanken+Grotesk:wght@400..700&family=JetBrains+Mono:wght@400..600&display=swap');"; cat "$CSS"; } > packages/web/.design-sync-styles.css
  ```
  The prepended `@import` is what turns `[FONT_MISSING]` into `[FONT_REMOTE]`.
- **`@/` alias** resolves via `cfg.tsconfig` (`packages/web/tsconfig.json`, has `paths`).

## Verification

- **No Playwright installed.** Renders were verified with **system Chrome + CDP** (`/tmp/shot.ts`
  harness), not the converter's render check; validate is run with `--no-render-check`.
- All 3 components authored + graded **good** (`.design-sync/.cache/review/*.grade.json`).
- **PublicThemeControl** dropdown is interaction-only (internal `useState`) — only the closed
  trigger renders statically; the open menu is intentionally not captured.

## Known render warns (expected — not new)

- `[FONT_REMOTE]` — brand fonts load from Google Fonts at runtime (by design; not bundled).
- `[RENDER_SKIPPED]` — because `--no-render-check` (we verify via system Chrome instead).

## Re-sync risks (watch-list)

- **Compiled-CSS coverage**: `.design-sync-styles.css` contains only the utilities the **app**
  actually uses. A preview/agent class outside that set won't be styled. Mitigated by composing
  real components + the conventions header's enumerated utilities. If you author previews using
  new utility classes, confirm they appear in the compiled CSS (or add their usage in `src/`).
- **Gitignored build inputs**: `.design-sync-styles.css` and the `@patra/web` self-symlink are
  NOT committed — regenerate both on a fresh clone (commands above).
- **Component moves**: if a scoped component's source path changes, update both
  `cfg.componentSrcMap` and `packages/web/design-sync.entry.tsx`.
- **External images**: `UserAvatar` `WithImage` cell uses `pravatar.cc` — offline capture shows
  the initials fallback (not a failure).

## Re-sync command

```sh
SB="<design-sync skill base dir>"
mkdir -p .ds-sync && cp -r "$SB"/package-build.mjs "$SB"/package-validate.mjs "$SB"/package-capture.mjs "$SB"/resync.mjs "$SB"/lib "$SB"/storybook .ds-sync/
echo '{"name":"ds-sync-deps","private":true}' > .ds-sync/package.json
(cd .ds-sync && npm i esbuild ts-morph @types/react)
ln -sfn "$PWD/packages/web" packages/web/node_modules/@patra/web        # fresh clone only
# regenerate compiled CSS (block above), then:
node .ds-sync/package-build.mjs --config .design-sync/config.json --node-modules packages/web/node_modules --entry packages/web/design-sync.entry.tsx --out ./ds-bundle
node .ds-sync/package-validate.mjs ./ds-bundle --no-render-check
```
Project: https://claude.ai/design/p/e7766180-91b9-4303-9151-cd86bbf26535
