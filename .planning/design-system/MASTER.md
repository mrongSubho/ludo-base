# Ludo Base — Master Design System

Generated via `ui-ux-pro-max` logic for a **Retro-Futuristic Onchain Arena**.

## 1. Visual Strategy: Retro-Futurism
**Aesthetic**: Synthetic noir meets high-stakes competitive gaming. 
**Key Pillars**: Neon glow, glassmorphism, geometric structure, and sub-second feedback.

## 2. Color Palette (Tailwind Sync Required)

| Role | Color Name | Hex | Usage |
|------|------------|-----|-------|
| Background | `base-dark` | `#0F0F23` | Main app background, deep & immersive. |
| Surface | `surface-glass` | `bg-white/5` | Glassmorphic panels, backdrop-blur-lg. |
| Primary | `neon-violet` | `#7C3AED` | Primary brand color, branding elements. |
| Accent 1 | `neon-cyan` | `#22D3EE` | (Replaces hardcoded `#22d3ee`) Competitive status, active. |
| Accent 2 | `neon-amber` | `#F59E0B` | (Replaces hardcoded `#f59e0b`) Rewards, coins, VIP. |
| Danger | `neon-rose` | `#F43F5E` | CTA, delete, critical alerts. |

## 3. Typography
- **Headings**: `Russo One` (Esports/Action vibe)
- **Body**: `Chakra Petch` (Technical/Competitive vibe)
- **Scale**:
  - `Display`: 2xl (24px) - 4xl (36px)
  - `Header`: lg (18px) - xl (20px)
  - `Body`: sm (14px) - base (16px)
  - `Micro`: xs (12px) - **Minimum allowable size**. (Refactor all 9px/10px)

## 4. Spacing Rules
**Rule**: No arbitrary `[...]` values. Use the 4px grid.
- `Panel Gutter`: `64px` → `h-16` / `top-16`
- `Bottom Control`: `80px` → `h-20` / `bottom-20`
- `Card Radius`: `32px` → `rounded-3xl` (24px) or custom `rounded-[2rem]` if unified.

## 5. Interaction Patterns
- **Hover**: Subtle glow (`shadow-neon`) + scale(1.02)
- **Active**: Inner shadow (inset) + reduced opacity
- **Transitions**: Every state change MUST use `duration-200 ease-out`

## 6. Implementation Priorities (From UI-Review)
1. **Tokenize Colors**: Refactor `tailwind.config.ts` to include these neon shades.
2. **Standardize Spacing**: Replace `[64px]` and `[80px]` with `16` and `20`.
3. **Typography Cleanup**: Increase all `text-[9px]` to `text-xs`.
