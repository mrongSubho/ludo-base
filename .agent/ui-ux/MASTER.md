# Ludo Base - Master Design System

This document codifies the **Terminal-Glass** design language for `ludo-base`.

## 🎨 Core Palette

| Token | Value | Usage |
| :--- | :--- | :--- |
| **Primary BG** | `#0D0D0D` | Base layer for cosmic gradients. |
| **Accent Cyan** | `#00E5FF` | Focus rings, active pills, terminal accents. |
| **Ludo Blue** | `#2196F3` | Primary action color. |
| **Glass Card** | `rgba(255, 255, 255, 0.03)` | Card/Panel surface base. |
| **Border** | `rgba(255, 255, 255, 0.15)` | Sharp grid lines and dividers. |

## ✨ Visual Effects

- **Background**: `cosmic-core-bg` (Radial gradients + Noise Filter overlay).
- **Glassmorphism**: 
  - `backdrop-filter: blur(24px)`
  - `border: 1px solid rgba(255, 255, 255, 0.1)`
  - `box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.3)`
- **Animations**: 
  - ` drift-orb`: 20-30s floating flares.
  - `shimmer`: for loading/pulse states.
  - `hover`: smooth 200-300ms transitions.

## 📐 Layout & Spacing

- **Typography**: `Inter`, system-ui. Monospaced for labels where specified.
- **Rounding**: 
  - `radius-lg`: 16px (standard cards).
  - `radius-xl`: 20px (large panels/header).
  - `radius-pill`: 9999px (match type buttons).
- **Shell**: Max-width 500px (Mobile-first app shell).

## 🚫 Constraints (Anti-patterns)

- **NO** emojis as icons. Use Lucide/React-Icons.
- **NO** flat or opaque panels. Always use glassmorphism with blur.
- **NO** sharp corners on interactive elements.
- **NO** bright neon backgrounds (reserved for accents only).
