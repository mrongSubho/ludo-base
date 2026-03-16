# GDD Visual Assets

This folder is the source of truth for Game Design Document visuals referenced by `GAME_DESIGN_DOCUMENT.md`.

## Required Files

Static screenshots:
- `dashboard-overview.svg`
- `lobby-flow.svg`
- `classic-board.svg`
- `snakes-board.svg`
- `social-surface.svg`

Animated captures:
- `quickmatch-flow.gif`
- `shuffled-board-layout.gif`
- `invite-to-match.gif`

## Capture Guidance

### `dashboard-overview.svg`
Capture the home dashboard with:
- header visible
- footer visible
- one slide panel open
- consistent final theme applied

### `lobby-flow.svg`
Capture a teamup lobby with:
- host slot visible
- at least one invited or connected player
- match settings visible
- private-lobby state, not an empty shell

### `classic-board.svg`
Capture an active Classic or Power match with:
- dice visible
- player cards visible
- token state visible
- a shuffled corner assignment if possible

### `snakes-board.svg`
Capture an active Snakes & Ladders match with:
- current player indicator
- message/feedback area
- timer or turn-state feedback

### `social-surface.svg`
Capture a social/profile state with:
- profile panel or public profile modal
- friends or message context
- realistic identity data, not placeholders if avoidable

## Capture Standards

- Prefer mobile-first framing first.
- Use one consistent visual theme across all screenshots.
- Avoid empty states unless the screen is specifically designed to demonstrate one.
- Use production-like wallet/profile names where possible.
- Replace files in place so markdown links remain stable.
- Current repo state includes real deployment captures for dashboard, teamup lobby, profile, and classic board states.
- Remaining placeholder-only assets are `snakes-board.svg` and the three GIF files.
