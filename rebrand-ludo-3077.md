# Rebrand to Ludo 3077: The Onchain Arena

## 1. Overview & Objectives
Rebrand the game from **"Ludo Base: The Onchain Arena"** to **"Ludo 3077: The Onchain Arena"**.

### Boundaries Preserved:
- **Internal Cryptographic Signatures**: Strings in `lib/matchProof.ts`, `lib/sessionProof.ts`, `lib/walletLink.ts`, and `lib/notices.ts` are left untouched to preserve signature verification and backward compatibility.
- **Smart Contracts & Frozen Migrations**: Historical database migrations (`migrations/`, `supabase/migrations_archive/`, etc.) and Solidity contracts remain untouched to adhere to the CI archive-guard test.

---

## 2. File Change Checklist

### User-Facing UI & Metadata
- [x] `app/layout.tsx`: Updated page `title`, `openGraph.title`, and Farcaster frame name to `Ludo 3077 : The Onchain Arena`.
- [x] `app/manifest.ts`: Updated `name` to `Ludo 3077 — The Onchain Arena` and `short_name` to `Ludo 3077`.
- [x] `app/page.tsx`: Updated hero loading title from `LUDO BASE` to `LUDO 3077`.
- [x] `app/components/SettingsPanel.tsx`: Updated `About Ludo 3077`, `Ludo 3077 · Onchain Arena`, and version footer.
- [x] `app/components/LudoWalletModal.tsx`: Updated modal title to `Ludo 3077 · Onchain Arena`.
- [x] `app/global-error.tsx`: Updated error kicker to `Ludo 3077 · Something broke`.
- [x] `app/privacy/page.tsx`: Updated title, description, and kicker to `Ludo 3077`.
- [x] `app/terms/page.tsx`: Updated title, description, kicker, and section 1 to `Ludo 3077`.
- [x] `app/components/Phase0aSpikePanel.tsx`: Updated explanatory copy to `Ludo 3077`.

### Wallet Connectors & Service Worker
- [x] `app/Providers.tsx`: Updated `appName: "Ludo 3077"`.
- [x] `app/components/CdpAuthProvider.tsx`: Updated `appName: "Ludo 3077"`.
- [x] `hooks/useBaseAccountSigner.ts`: Updated `APP_NAME = "Ludo 3077"`.
- [x] `lib/wcWallet.ts`: Updated `name: "Ludo 3077"` and `description: "Ludo 3077 — The Onchain Arena"`.
- [x] `public/sw.js`: Updated push notification default title to `Ludo 3077`.
- [x] `app/api/push/test/route.ts`: Updated test push title to `Ludo 3077`.

### Documentation & Comments
- [x] `README.md`: Updated title and intro to `Ludo 3077`.
- [x] `DESIGN.md`: Updated title.
- [x] `ENGINE_LOGIC.md`: Updated title and author footnote.
- [x] `AGENTS.md`: Updated header intro.
- [x] `scripts/dev-room-server.ts`: Updated status text.

---

## 3. Verification & Quality Gates
- **TypeScript**: `npx tsc -p tsconfig.json --noEmit` passed with 0 errors.
- **Engine & Security Test Suite**: `npm test` ran 607 tests: **596 passed, 0 failed, 11 skipped**.
- **Wrangler Secret-Leak Guard**: `npm run check:wrangler-guard` passed 9 of 9 checks.
- **ESLint**: `npm run lint` passed with 0 errors.
