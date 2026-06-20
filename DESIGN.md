# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-06-21
- Primary product surfaces: public home, public docs, README, authenticated document/share workspace
- Evidence reviewed: `README.md`, `docs/assets/patra-logo.svg`, `docs/assets/patra-banner.svg`, `packages/web/src/pages/public-home.tsx`, `packages/web/src/pages/public-docs.tsx`, `packages/web/src/globals.css`

## Brand
- Personality: trustworthy, precise, self-hostable, agent-friendly, document-first
- Trust signals: Git-backed versioning, scoped tokens, access control, auditability, clear deployment language
- Avoid: generic SaaS gradient hero pages, decorative-only visuals, dark hacker/security styling, cartoonish mascots, oversized marketing copy

## Product goals
- Goals: make publishing generated HTML, static docs, and shareable previews feel reliable and inspectable
- Non-goals: broad file-suite positioning, consumer social sharing, visual spectacle at the expense of workflow clarity
- Success signals: users understand draft publishing, Git-backed storage, sharing controls, and docs entry points from the first screen

## Personas and jobs
- Primary personas: self-hosting operators, teams reviewing generated artifacts, coding agents or developers publishing HTML outputs
- User jobs: publish a file or site, share it with the right audience, inspect docs/API setup, manage access with confidence
- Key contexts of use: local development, self-hosted deployment, agent handoff, team review

## Information architecture
- Primary navigation: Home, Docs, auth/workspace action, theme control
- Core routes/screens: `/`, `/docs`, `/docs/:guide`, `/login`, `/app`, `/drafts`, `/files`, `/shared`, `/teams`, `/settings`, `/admin`
- Content hierarchy: product value and visual cue first, then workflow cards, capabilities, CLI example, docs guides and search

## Design Principles
- Lead with the working product: visuals should explain publishing, sharing, and access control.
- Keep operational density: documentation and workspace UI should be scannable, not sparse marketing copy.
- Make trust visible: security, Git history, tokens, and access states should be represented in copy and visuals.

## Visual Language
- Color: off-white backgrounds, deep teal/emerald anchors, warm gold accents, charcoal text; avoid one-note palettes
- Typography: system sans, compact headings in tool/docs surfaces, larger type only for public page hero
- Spacing/layout rhythm: constrained max-width, full-width bands, 8px radii, consistent 4/5/6 spacing steps
- Shape/radius/elevation: modest radius, subtle borders, soft shadows only for imagery or lifted panels
- Motion: minimal; use hover/focus feedback, avoid decorative animation
- Imagery/iconography: leaf/page motif, document cards, Git/version cues, share-link and lock/access symbols; no readable fake UI text in generated imagery

## Components
- Existing components to reuse: `PublicAuthAction`, `PublicThemeControl`, route pages, Tailwind token classes
- New/changed components: public page image panels, docs visual cards, guide cards with operational metadata
- Variants and states: hover, focus, active guide, search results, dark-mode color adaptation
- Token/component ownership: keep styling in Tailwind classes and existing CSS theme variables

## Accessibility
- Target standard: practical WCAG AA for contrast, keyboard navigation, and semantic structure
- Keyboard/focus behavior: links/buttons remain native controls with visible focus from browser defaults or border changes
- Contrast/readability: avoid low-contrast teal on dark backgrounds; support light and dark theme variables
- Screen-reader semantics: generated images need meaningful alt text when informative, empty alt only when decorative
- Reduced motion and sensory considerations: no required motion

## Responsive Behavior
- Supported breakpoints/devices: mobile, tablet, desktop, GitHub Pages static rendering
- Layout adaptations: single-column on mobile, two-column hero/docs layouts on wider screens
- Touch/hover differences: cards and links must not rely on hover-only disclosure

## Interaction States
- Loading: keep existing session/auth loading behavior
- Empty: docs search shows no-match text
- Error: docs unknown slug redirects to docs index
- Success: auth action points signed-in users to workspace
- Disabled: no disabled states introduced in the public polish pass
- Offline/slow network: local assets avoid third-party image dependencies

## Content Voice
- Tone: direct, technical, confident, operator-friendly
- Terminology: use Patra, docs, drafts, static sites, Git-backed repos, share links, scoped tokens
- Microcopy rules: prefer concrete capability statements over broad claims

## Implementation Constraints
- Framework/styling system: React 19, react-router v7, Vite, Tailwind v4, Bun/Turbo
- Design-token constraints: use existing CSS variables and Tailwind utility classes; no new design dependency
- Performance constraints: README/docs images should be local and resized for reasonable repository weight
- Compatibility constraints: public site must work in GitHub Pages build with `VITE_PUBLIC_SITE=true`
- Test/screenshot expectations: run typecheck/build and browser smoke screenshots for public home/docs when changed

## Open Questions
- [ ] Whether Patra should keep both the SVG README banner and generated README hero long-term / owner: maintainer / impact: README visual density
