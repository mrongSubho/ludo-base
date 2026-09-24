# Phase 0a Spike Checklist — CDP project + parent-signed SIWE / EIP-712

| Field | Value |
| --- | --- |
| **Plan** | `docs/planning/SMART_WALLET_PLAN.md` §5 Phase **0a** |
| **Gate** | Allowed during stable build (thin auth spike only) |
| **Out of scope** | Sub-account default · CHIPS spend-permission product UX · Sepolia value playtests · connect cutover |
| **Verified** | 2026-09-24 against `docs.cdp.coinbase.com` (Wallets / User Auth / React Hooks / SIWE) |
| **Status** | Started — scaffold in repo; portal + live spike open |

---

## Confirmed CDP API surface (do not invent beyond this)

| Name | Package | Notes |
| --- | --- | --- |
| `CDPHooksProvider` | `@coinbase/cdp-hooks` | Exists — `config: { projectId, ethereum?: { createOnLogin: "eoa" \| "smart" }, solana?, appName?, disableAnalytics? }` |
| `CDPReactProvider` / `AuthButton` / `SignInModal` | `@coinbase/cdp-react` | Optional UI layer; `authMethods: ["email","sms","oauth:google","oauth:x","siwe:base"]` |
| `@coinbase/cdp-core` | core | `initialize`, `signInWithOAuth`, `signInWithSiwe`, `verifySiweSignature` |
| `useSignInWithEmail` / `useVerifyEmailOTP` | hooks | 6-digit OTP, **10 min** email expiry |
| `useSignInWithSiwe` / `useVerifySiweSignature` / `useLinkSiwe` | hooks | EIP-4361 challenge → personal_sign → verify |
| `signInWithOAuth("google"\|"apple"\|"x"\|"telegram")` | core | **Redirect OAuth** in the current default browser |
| `useLinkOAuth` / `useLinkGoogle` / `useLinkApple` | hooks | Post-login method linking |
| `useEvmAddress` / `useEvmSmartAccounts` / `useEvmAccounts` | hooks | `useEvmAddress` = **first smart, then first EOA** — for identity use `evmSmartAccountObjects[0]` (parent) |
| `useSignEvmMessage` | hooks | `signMessage({ evmAccount, message })` style — **confirm exact args in spike** |
| `useSignEvmTypedData` | hooks | Match-session EIP-712 — **confirm exact args in spike** |
| `useSignEvmTransaction` / `useSendUserOperation` | hooks | `sendUserOperation({ dataSuffix?, useCdpPaymaster? })` |
| `useCreateSpendPermission` / `useListSpendPermissions` / `useRevokeSpendPermission` | hooks | Phase **0b/2 only** — not 0a product UX |
| EIP-8021 `dataSuffix` | `sendUserOperation` param | Confirmed on user ops — still prove on every CDP send path later |
| `siwe:base` | `@coinbase/cdp-react` + peer `@base-org/account` | Sign in with Base; **one** Base Account — do **not** run parallel with a second account system |
| CDP SIWE ≠ Ludo SIWE | — | CDP `signInWithSiwe` is **login**. Ludo app session is `lib/sessionProof.buildSiweMessage` + `/api/siwe/verify`. Spike signs the **Ludo** text with the parent; CDP SIWE is optional login path |

**Facebook:** CDP social login documents **Google, Apple, X, Telegram only** (no Facebook). Keep Facebook off the CDP auth table until portal/docs confirm it; app-layer Facebook identity is out of 0a.

**Not found / rename risks (confirm live):** `useCdpPaymaster` (docs show `useCdpPaymaster: true` **boolean on send**, not a hook) · `wallet_addSubAccount` (0b) · `createOnLogin: "smart"` creates **EOA + Smart Account** — identity parent = the smart account, not the EOA.

**Spike finding (2026-09-24):** `signEvmMessage` / `signEvmTypedData` return **"EVM account not found"** when `evmAccount` is the Smart Account address. `evmAccount` must be an **EOA** (`evmAccountObjects[0]`). Message signing as the parent therefore = owner-EOA signature + ERC-1271/6492 verify against the smart account. Do **not** promote the EOA to player id.

---

## A. CDP Portal (human — no code)

- [ ] Create free CDP Portal account + project at https://portal.cdp.coinbase.com (business verification **not** required for non-custodial wallets)
- [ ] Copy **Project ID** → set `NEXT_PUBLIC_CDP_PROJECT_ID` in `.env.local` (never commit)
- [ ] **Wallets → Non-custodial → Clients → Add domain:** `http://localhost:3000` for dev
- [ ] Production CDP project: **only** the real production origin (never `localhost`)
- [ ] Enable auth methods: Email OTP, SMS OTP, Google, Apple, X, Telegram (passkey / SIWE Base as available)
- [ ] Auto-linking ON where the portal exposes it
- [ ] Branding tab: app name (+ logo if you want branded OTP mail)
- [ ] Record portal screenshots / project id prefix in this checklist notes (not secrets)

## B. Repo scaffold (this turn)

- [x] `lib/walletSigner.ts` — `WalletSigner` interface (`signMessageAsync` / `signTypedDataAsync`)
- [x] `hooks/useWalletSigner.ts` — wagmi default impl (CDP impl is Phase 1 swap)
- [x] `NEXT_PUBLIC_CDP_PROJECT_ID` + `NEXT_PUBLIC_CDP_AUTH` in `.env.example`
- [x] **Spike-only** deps installed: `@coinbase/cdp-hooks` + `@coinbase/cdp-core` (no `@coinbase/cdp-react` / `siwe:base` in 0a)
- [x] Feature flag `NEXT_PUBLIC_CDP_AUTH=1` mounts `CDPHooksProvider` beside wagmi via `app/components/CdpAuthProvider.tsx` — **no** default connect cutover
- [x] Parent signer: `hooks/useCdpParentSigner.ts` (refuses non-parent `account`)
- [x] Spike console: `/spike/cdp` → `app/components/Phase0aSpikePanel.tsx` (C2 SIWE · C3 EIP-712 · C4 move sign)

## C. Spike script (parent-signed proofs only)

Target chain: **Base Sepolia 84532**. No value transfers. No sub-account default.

### C1. Sign-in + parent address

- [ ] Mount `CDPHooksProvider` with `projectId`, `ethereum: { createOnLogin: "smart" }`
- [ ] Email OTP sign-in (and one social: Google **or** Apple)
- [ ] Log `user.evmSmartAccountObjects[0].address` **and** `user.evmAccountObjects[0].address`
- [ ] **Assert identity parent = smart account** (`evmSmartAccountObjects[0]`). Record which the EOA is (owner) and never bind EOA or a sub to `wallet_address`
- [ ] Note OAuth presentation: popup vs full redirect; browser is the user’s default browser (no in-app webview)

### C2. Ludo app session (parent personal_sign)

- [ ] Build message via `lib/sessionProof.buildSiweMessage` (existing 7-day TTL text)
- [ ] Sign with **parent** via `useSignEvmMessage` (or wagmi adapter once CDP is wired)
- [ ] POST `/api/siwe/verify` → expect `sessionId` (6492/1271 path already in `lib/walletVerify.ts`)
- [ ] Confirm **no** popup loop with `AppSessionGuard` backoff

### C3. Match-session EIP-712 (parent typed_data)

- [ ] Build `LudoMatchSession` via `buildSessionDomain(84532)` + `buildMatchSessionPayload`
- [ ] Sign with **parent** via `useSignEvmTypedData`
- [ ] Submit Edge `move-auth` `provisional-session` (or dry-run verifier) → grant accepted
- [ ] Note Coinbase/wallet **review UI** copy for custom EIP-712 (no `verifyingContract` — intentional)

### C4. Move proof personal_sign (parent)

- [ ] `buildMoveMessage` (or seed/pass) signed by parent
- [ ] `verifyPersonalSign` accepts (EOA fast path or 1271/6492 smart path)

### C5. Negative / identity guards

- [ ] If a second EOA+Smart pair is present, confirm app **does not** treat the EOA as `wallet_address`
- [ ] Regenerate / leave CDP session → re-login same method → **same parent address**
- [ ] Guest stash migration path documented (first CDP login → `migrateGuestStash` to parent) — manual check optional in 0a

### C6. Explicitly skipped in 0a

- [x] No `wallet_addSubAccount` / `defaultAccount: 'sub'`
- [x] No CHIPS `useCreateSpendPermission` product flow
- [x] No Sepolia value playtest / faucet-funded join
- [x] No default connect-button cutover / connector removal

## D. Exit criteria (0a green)

| # | Criterion |
| --- | --- |
| 1 | Portal project + domain allowlist live; `NEXT_PUBLIC_CDP_PROJECT_ID` set |
| 2 | Parent smart-account address is the only id logged for the player |
| 3 | Ludo SIWE message verifies 200 `/api/siwe/verify` |
| 4 | Match-session EIP-712 verifies on Edge (or local verifyTypedDataSign matrix) |
| 5 | Move personal_sign verifies |
| 6 | OAuth = default-browser redirect/popup; no captive webview |
| 7 | Written note: Facebook in/out of CDP; `useSignEvmMessage` / `useSignEvmTypedData` exact signatures |
| 8 | Nothing from C6 shipped |

## Notes (fill during spike)

```
Date: 2026-09-24
CDP project id (prefix only): 364b3239
Parent smart account 0x…: 0x221Aef4752C1C3890B2a18aF5e781dfa9260F5f8
Owner EOA 0x… (never use as wallet_address): 0x6e1156c1502a66D685339724320475F6a99a16E1
userId: 6a67ed0-7782-4fc7-b0b5-7f1ba6ee088a
Email OTP: pass (session created)
Google or Apple OAuth: (not run yet)
useSignEvmMessage args: { evmAccount, message } → { signature }
useSignEvmTypedData args: { evmAccount, typedData: { domain, types, primaryType, message } } → { signature }

BLOCKER (first run, 01:13): all of C2/C3/C4 failed with "EVM account not found"
when evmAccount = parent Smart Account 0x221Aef….
CDP signEvmMessage / signEvmTypedData only accept EOA (evmAccountObjects).
Fix: sign with owner EOA, claim parent smart as identity; verify via 1271/6492.
Retry pending after useCdpParentSigner update.

/api/siwe/verify: pending retry
move-auth provisional-session: pending
Builder-code dataSuffix on sendUserOperation (if any tx): n/a in 0a
Blockers: owner-EOA sig vs smart-account 1271 verify — if /api/siwe/verify
returns signer-mismatch, need 6492 wrap or CDP smart-account sign path.
```

---

*Parent identity + CHIPS join-auth rules live in `SMART_WALLET_PLAN.md` §1.1 / §3.2. Do not expand 0a scope into 0b (sub-accounts, spend permissions, value).*
