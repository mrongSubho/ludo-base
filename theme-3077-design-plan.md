# Theme 3077: Design Architecture & Codebase Map

> **Product:** Ludo 3077: The Onchain Arena  
> **Target:** Flagship "3077" Visual Identity & Cyber-Tactical Design System  
> **Lead Architect:** Senior Frontend Architect (`@[frontend-specialist]`)

---

## 🎨 1. Design Commitment (Anti-Safe Harbor)

### 🧠 Deep Design Thinking & Context Analysis
- **Sector & Genre:** High-stakes on-chain competitive board combat (Web3 / Base Sepolia / Turn-Based Tactical Ludo).
- **Emotions to Evoke:** High-precision tactical warfare, razor-sharp mechanical stakes, neural cybernetic control, tournament prestige, and autonomous guild/syndicate dominance.
- **The Soul of the App in One Word:** **`KINETIC-CYBERNETIC`**.
- **What to Reject (The Cliché Scan & Anti-Safe Harbor):**
  - ❌ **Purple Ban Enforcement:** Absolutely zero generic violet/magenta neon AI blobs (`#7C3AED` / purple mesh glows are stripped).
  - ❌ **No Generic Bento Grids:** The interface does not hide behind safe, cookie-cutter rounded boxes.
  - ❌ **No Fluffy "Safe SaaS" Softness:** Say goodbye to bubbly `rounded-md` (8px) everywhere. We move to crisp technical chamfers (0px–3px angular cuts on control frames) balanced with precision pill badges and tactical display viewports.
  - ❌ **No Static Stagnation:** Micro-interactions have physical mechanical feedback (`scale`, tactical edge-flare, HUD laser sweeps, spring physics).

### 🎨 The Radical Style: **`CYBER-TACTICAL 3077` (High-Density Mechanical HUD)**
- **Palette Identity:**
  - **Void Substrate:** Deep Carbon Titanium (`#07080B` to `#0B0E14`), high-depth matte rather than muddy purple glass.
  - **Primary Laser Accent:** Monochromatic Hyper-Cyan (`#00E5FF` / `#22D3EE`) with deep cyan grounding (`#083344`).
  - **Tactical Alert & Alert Hazards:** Kinetic Amber / Sodium Flare (`#F59E0B` / `#FFB703`) for turn clocks, active wagers, and critical timers.
  - **Combat Insignia Tones (The 4 Team Colors for 3077):**
    - 🟢 **Green (Matrix Overdrive):** `#00FF66` / `#10B981` (High-visibility neon emerald).
    - 🔴 **Red (Laser Warning):** `#FF0055` / `#F43F5E` (High-intensity cyber crimson).
    - 🔵 **Blue (Cobalt Core):** `#0099FF` / `#2563EB` (Electrified plasma cobalt).
    - 🟡 **Yellow (Solar Hazard):** `#FFD000` / `#FACC15` (Pure high-lux solar cadmium).
- **Typography Matrix:**
  - **Display / Headers:** `Russo One` + `Chakra Petch` (uppercase, letter-spacing `0.15em` to `0.25em`, angular cuts).
  - **Data / Numerals:** `Inter Tight` with `tabular-nums` + monospace micro-coordinates (`[POS: 52]`, `[SEQ: 04]`, `[CHIPS: 10,000]`).
  - **Body / Micro-labels:** `Chakra Petch` / `Inter`, hard floor at 10px, high-contrast crisp text.

---

## 🗺️ 2. Comprehensive Codebase Map (Every Touchpoint)

To implement the **3077** theme seamlessly without regressions, every touchpoint is categorized across 9 architectural layers:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        LUDO 3077 CODEBASE MAP                          │
└────────────────────────────────────────────────────────────────────────┘
  │
  ├── LAYER 1: Core Token Layer & Stylesheets (Root Styling)
  │     ├── app/globals.css
  │     ├── app/styles/tokens.css
  │     ├── app/styles/themes/theme-3077.css (NEW)
  │     ├── app/styles/themes/daybreak.css
  │     ├── app/styles/themes/default.css
  │     ├── app/styles/panels.css
  │     ├── app/styles/board.css
  │     └── app/styles/motion.css
  │
  ├── LAYER 2: State, Preference & Provider Infrastructure
  │     ├── app/layout.tsx (SSR theme cookie & body classes)
  │     ├── hooks/usePreferences.ts (theme storage, snapshot, DOM toggle)
  │     ├── app/components/SettingsPanel.tsx (Theme switcher tabs)
  │     ├── app/components/FirstRunSetupPanel.tsx (Onboarding selection)
  │     ├── app/components/ThemeNudge.tsx (Post-arena toast)
  │     └── app/components/MarketplacePanel.tsx (Theme gear inventory)
  │
  ├── LAYER 3: App Shell, Lobby & Global Navigation Chrome
  │     ├── app/page.tsx (Backdrop, splash, ticker, lobby hero, layout)
  │     ├── app/components/HeaderNavPanel.tsx (Stats, chips, tier, icons)
  │     ├── app/components/FooterNavPanel.tsx (Dock nav, badges, active tabs)
  │     ├── app/components/ActivityFeed.tsx (Global live combat events)
  │     └── app/components/ConnectionBadge.tsx (Latency / WebSocket status)
  │
  ├── LAYER 4: Game Board & In-Match Battle Arena
  │     ├── app/components/Board.tsx (Root container, zoom, outer frame)
  │     ├── app/components/BoardGrid.tsx (15x15 SVG grid, safe cells, path tiles)
  │     ├── app/components/BoardTokens.tsx (GSAP FLIP token hops, rings, orbs)
  │     ├── app/components/BoardHome.tsx (4 player bases, home yard chambers)
  │     ├── app/components/BoardOverlays.tsx (Turn beams, power tile reveals)
  │     ├── app/components/BoardHeaderCompact.tsx (Turn header, match status)
  │     ├── app/components/ActionDice.tsx & LudoDice.tsx (3D dice roll HUD)
  │     ├── app/components/ThinkingOrb.tsx (Canvas particle beacon)
  │     └── app/components/MatchStatsOverlay.tsx (End-game victory/defeat podium)
  │
  ├── LAYER 5: Tactical Drawers & Sandwich Panels (Slide-Overs)
  │     ├── app/components/GamePanelShell.tsx (Header, back button, frame)
  │     ├── app/components/UserProfilePanel.tsx & MatchHistoryTab.tsx
  │     ├── app/components/ArenaPanel.tsx & LiveArenaStage.tsx
  │     ├── app/components/FriendsPanel.tsx & MessagesPanel.tsx
  │     ├── app/components/MissionPanel.tsx & RankingsPanel.tsx
  │     └── app/components/BurnPanel.tsx (CHIPS deflation chamber)
  │
  ├── LAYER 6: Wallet Hubs, Allowances & Transact Sheets
  │     ├── app/components/AllowanceHubSheet.tsx & ClaimHubSheet.tsx
  │     ├── app/components/RevokeAllowanceSheet.tsx
  │     ├── app/components/InGameWalletPanel.tsx & ChipsWalletPanel.tsx
  │     └── app/components/SendTokenSheet.tsx, SendNativeSheet.tsx, SwapSheet.tsx
  │
  ├── LAYER 7: Critical System Modals & Telemetry Overlays
  │     ├── app/components/SignWaitModal.tsx & GlobalSignWaitModal.tsx
  │     ├── app/components/ClaimingOverlay.tsx (Radar sweep radar)
  │     ├── app/components/LudoWalletModal.tsx (Connect dialog)
  │     ├── app/components/GuestWall.tsx & LandscapeGuard.tsx
  │     └── app/components/PanelErrorBoundary.tsx & app/global-error.tsx
  │
  ├── LAYER 8: Atomic UI Primitives & Components
  │     ├── app/components/Button.tsx (Variants: primary, secondary, danger, icon)
  │     ├── app/components/Chip.tsx (Types: filter, status, info, tones)
  │     ├── app/components/Switch.tsx (Tactical toggles)
  │     ├── app/components/ListRow.tsx & PanelTabs.tsx
  │     └── app/components/Toast.tsx
  │
  └── LAYER 9: Visual Regression Gates & Test Verification
        ├── scripts/visual-diff.mjs (Playwright visual baseline & diffing)
        └── tests/visual/baselines/ (Committed reference PNGs)
```

---

## 📋 3. Detailed Component & Surface Requirements

### Layer 1: Core Tokens & Stylesheets
- **File:** `app/styles/tokens.css` & `app/styles/themes/theme-3077.css`
  - Introduce `body.theme-3077` (and refine default dark properties).
  - Define semantic custom properties:
    - `--surface-page`: `#07080B` (Ultra-deep obsidian/carbon).
    - `--surface-panel`: `rgba(11, 14, 20, 0.94)` (Deep carbon chassis with 0.8px technical cyan border).
    - `--surface-recessed`: `rgba(0, 229, 255, 0.04)` (Negative micro-wells).
    - `--surface-hover`: `rgba(0, 229, 255, 0.08)`.
    - `--surface-active`: `rgba(0, 229, 255, 0.15)`.
    - `--accent`: `#00E5FF` (Laser Cyan) with text on accent `--accent-ink`: `#05131A`.
    - `--line-soft`: `rgba(0, 229, 255, 0.12)`.
    - `--line-strong`: `rgba(0, 229, 255, 0.35)`.
    - `--shadow-panel`: `0 20px 60px -10px rgba(0, 0, 0, 0.85), 0 0 20px -5px rgba(0, 229, 255, 0.15)`.
    - Strip purple remnants (`--cyber-primary: #7C3AED` $\to$ `#00E5FF`, `--theme-panel-bg: rgba(88,28,135,...)` replaced with carbon-glass).

### Layer 2: Theme Infrastructure & Selection
- **File:** `hooks/usePreferences.ts` & `app/layout.tsx`
  - Ensure `3077` is recognized as the premier theme mode (e.g., `'3077' | 'retro' | 'light'`).
  - Server-side cookie reading in `app/layout.tsx` applies `theme-3077` without hydration flash.
  - Update `SettingsPanel.tsx`, `FirstRunSetupPanel.tsx`, `ThemeNudge.tsx`, and `MarketplacePanel.tsx` to showcase the new **3077** theme with custom tactical preview swatches.

### Layer 3: Shell & Global Lobby
- **File:** `app/page.tsx`
  - Replace the background image with an updated high-tech cyber-grid canvas overlay or dark carbon mesh.
  - Update hero splash and lobby action cards (`.ludo-lobby-scope`) to use sharp, high-tech HUD cards with laser edge accents instead of generic rounded containers.
  - Ticker banner (`.ludo-ticker-scope`) gets a military-grade teleprompter style with neon status pips.

### Layer 4: The In-Match Game Board
- **Files:** `Board.tsx`, `BoardGrid.tsx`, `BoardTokens.tsx`, `BoardHome.tsx`, `BoardOverlays.tsx`
  - **Outer Frame:** Replace plain borders with a high-tech carbon perimeter with corner chamfers and circuit traces.
  - **15x15 Cells:** Clean geometric path rings, glowing star cells (safe-havens) using tactical crosshair vector glyphs.
  - **Home Bases (4 Quadrants):** Holographic radar rings corresponding to the 4 vibrant combat colors.
  - **Dice Area:** Floating cybernetic pedestal with pulse feedback on roll.
  - **ThinkingOrb (`ThinkingOrb.tsx`):** Ensure color palette maps to the 3077 cyan-electric plasma spectrum.

### Layer 5: Sandwich Panels & Drawers
- **Files:** `GamePanelShell.tsx`, `UserProfilePanel.tsx`, `MatchHistoryTab.tsx`, `MarketplacePanel.tsx`, etc.
  - Use `.ludo-panel-shell` with high-density carbon headers, uppercase monospace sub-headers (`[SYS_STAT: ONLINE]`).
  - Scoreboards and match history ribbons use sharp chamfered badges (`VICTORY` in emerald laser, `DEFEAT` in crimson).

### Layer 6 & 7: Wallet Sheets, Modals & Claim Radar
- **Files:** `SignWaitModal.tsx`, `ClaimingOverlay.tsx`, `AllowanceHubSheet.tsx`
  - Radar sweep in `ClaimingOverlay` aligned with the 3077 laser-cyan tactical sweep.
  - Pre-flight telemetry matrix inside `SignWaitModal` formatted like an avionics/cyberdeck simulation console.

---

## 🛠️ 4. Phased Implementation Roadmap

| Phase | Milestone | Scope | Validation Gate |
| :--- | :--- | :--- | :--- |
| **Phase 1** | **Token Architecture & Theme 3077 Stylesheet** | Create `app/styles/themes/theme-3077.css`, update `tokens.css`, register `@theme inline` variables, remove Purple Ban violations. | `npx tsc` + zero CSS parse errors |
| **Phase 2** | **Theme State & Runtime Wiring** | Wire `3077` into `app/layout.tsx`, `usePreferences.ts`, `SettingsPanel.tsx`, `FirstRunSetupPanel.tsx`, `MarketplacePanel.tsx`. | Instant theme toggle with 0 flash |
| **Phase 3** | **Shell, Lobby & Navigation Polish** | Style `page.tsx`, `HeaderNavPanel.tsx`, `FooterNavPanel.tsx`, ticker bar, and lobby mode selectors. | Responsive verification across 320px–1440px |
| **Phase 4** | **Game Board & Combat HUD Refinement** | Refine `BoardGrid.tsx`, `BoardHome.tsx`, `BoardTokens.tsx`, `BoardHeaderCompact.tsx`, `ThinkingOrb.tsx`. | Match playtest + frame-rate check (60fps) |
| **Phase 5** | **Panels, Hubs & Modal Systems** | Align all sandwich panels (`GamePanelShell.tsx`), `AllowanceHubSheet`, `SignWaitModal`, `ClaimingOverlay`. | Interactive modal audit in Retro, Daybreak & 3077 |
| **Phase 6** | **Visual Regression & CI Gates** | Update/verify `scripts/visual-diff.mjs`, run `npm test`, verify secret gates. | `npm test` + `visual:diff` passed |
