# DESIGN.md — Ludo Base UI contract

Existing-codebase mode. Match this system; do not invent a second language.

## Identity (keep)

- Chess-token board + ActionDice path picker + cosmic terminal glass
- Mobile-first shell (`max-width: 500px` on `app-shell`)
- Themes: `theme-retro-futurism` (default) / `theme-daybreak`

## Tokens (de facto)

| Role | CSS |
|------|-----|
| Background | `--ludo-bg` / `--ludo-bg-image` |
| Surface | `--panel-bg`, glass `border-white/10` |
| Ink | `--ludo-text`, muted `--ludo-muted`, faint `--ludo-faint` |
| Accent | cyan ~`#00E5FF` / Tailwind `cyan-400` |
| Board pastels | `--ludo-base-green` `#A8E6CF`, red `#FF8B94`, blue `#A2E1F6`, yellow `#FFD3B6` |

## Layout contract

- **Panels:** `top-64` / `bottom-80` sandwich (header + footer)
- **Footer:** fixed nav, z-index high, opaque enough that content never bleeds through
- **Board mobile:** measured square inside `board-main` — never force `100vw` height
- **Tap targets:** ≥ 44px on primary actions

## Type

- Display / CTAs: theme display face, uppercase, tight tracking
- Body / errors: ≥ 12px, high contrast
- **Floor:** avoid critical UI under 10px; status pills 10–11px ok

## Motion

- Prefer one clear moment over constant pulse
- All decorative animation must respect `prefers-reduced-motion: reduce`
- `focus-visible` rings on interactive controls (never `outline: none` without a replacement)

## Components

- `EmptyState` — empty + error in panels (`app/components/EmptyState.tsx`)
- Join flow: show waiting overlay immediately; fail in ~8s with **Try again**
- Wager is optional on lobby (collapsed); Free is default

## Copy

- Sentence case for explanations; uppercase only for chrome labels
- Name what the user controls (“Try again”, not “Retry request”)
- Errors state what failed and what to do next

## Do not

- New palettes or fonts without updating this file
- Duplicate panel class strings — reuse sandwich + glass tokens
- Ship multiplayer trust claims that the engine does not enforce
