# Patra — design system conventions

Patra is a warm, editorial product UI: a cream canvas, deep-teal primary, gold accents, and a literary serif for headings. It is built with **Tailwind CSS v4**, where every brand value is a CSS variable defined in an `@theme` block (shipped in `styles.css`). Build new UI by composing the Patra components below and styling layout with the token-backed utility classes named here.

## Setup — no provider needed

The components render standalone — there is no theme/context provider to wrap. The look comes entirely from the CSS variables in the bound `styles.css` (already loaded), so anything you build inherits the palette and fonts automatically.

- **Dark mode**: add `class="dark"` to an ancestor (e.g. `<html>` or a root `<div>`). Every `--color-*` token swaps to its dark value; nothing else changes.
- **Fonts** load at runtime from Google Fonts via an `@import` in `styles.css` — no setup.

## Styling idiom — Tailwind utilities backed by `@theme` tokens

Style with utility classes whose names map to the brand tokens. The palette utilities (use the `bg-`, `text-`, and `border-` forms):

| Token family | Utilities | Meaning |
|---|---|---|
| `background` / `foreground` | `bg-background`, `text-foreground` | page canvas (cream `#fbfaf6`) + ink (`#123331`) |
| `primary` | `bg-primary`, `text-primary-foreground` | deep teal `#0f766e` — primary actions, avatars |
| `muted` | `bg-muted`, `text-muted-foreground` | subtle surfaces + secondary text |
| `secondary` | `bg-secondary`, `text-secondary-foreground` | warm gold surface |
| `accent` | `bg-accent`, `text-accent-foreground` | soft teal tint |
| `destructive` | `bg-destructive` | danger |
| `border` | `border-border` | hairline dividers (pair with `border`) |

- **Radius**: the house rounding is `rounded-lg` (`--radius: .5rem`). Use it on cards, buttons, inputs.
- **Type**: headings (`<h1>`–`<h3>`) are **automatically** set in the display serif **Fraunces** via base styles — just use heading tags, do *not* reach for a `font-*` utility (none ships for it). Body text is **Hanken Grotesk** by default. For code/SHAs/tokens use the `font-mono` utility (**JetBrains Mono**).
- **Direct variables**: every token is also a raw CSS var if you need one outside a utility — `var(--color-primary)`, `var(--color-muted-foreground)`, `var(--font-display)`, `var(--radius)`.

Stay within these names — they are what ships in `styles.css`. Read that file before inventing a class.

## Where the truth lives

- `styles.css` — the full token set (`:root` + `.dark`) and the shipped utilities. Read it first.
- Each component's `<Name>.d.ts` (its props/API) and `<Name>.prompt.md` (usage) under `components/<group>/`.

## Components (window.Patra)

- **UserAvatar** (`common`) — circular avatar; renders `avatarUrl` as a photo, else initials from `displayName` on the primary token. Sizes `sm | md | lg`.
- **EmptyState** (`common`) — centered empty surface: `icon` (a bare `<svg>`, sized by the slot), `title`, `description`, `action` (compose a button with `bg-primary`).
- **PublicThemeControl** (`layout`) — light/dark/system theme switcher button.

## One idiomatic build snippet

```tsx
// A Patra-styled panel: editorial heading + a teammate row + an empty body.
<div className="rounded-lg border border-border bg-background p-6">
  <h2 className="text-foreground">Shared with you</h2>{/* Fraunces, automatic */}
  <div className="mt-4 flex items-center gap-3">
    <UserAvatar displayName="Grace Hopper" size="sm" />
    <span className="text-sm text-muted-foreground">Grace shared 2 documents</span>
  </div>
  <EmptyState
    title="Nothing else yet"
    description="New shares show up here."
    action={
      <button className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
        Browse files
      </button>
    }
  />
</div>
```
