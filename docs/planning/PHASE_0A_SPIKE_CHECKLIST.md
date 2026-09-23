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
- [ ] **Spike-only** dep install when ready to run (flag off by default):
      `npm i @coinbase/cdp-hooks @coinbase/cdp-core`
      (+ `@coinbase/cdp-react` / `@base-org/account` only if using `AuthButton` / `siwe:base`)
- [ ] Optional: feature flag `NEXT_PUBLIC_CDP_AUTH=1` to mount `CDPHooksProvider` beside wagmi — **no** default connect cutover in 0a

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
Date:
CDP project id (prefix only):
Parent smart account 0x…:
Owner EOA 0x… (never use as wallet_address):
Email OTP: pass/fail
Google or Apple OAuth: presentation (popup/redirect):
useSignEvmMessage args (paste signature):
useSignEvmTypedData args (paste signature):
/ api/siwe/verify: status
move-auth provisional-session: status
Builder-code dataSuffix on sendUserOperation (if any tx): n/a in 0a
Blockers:
```

---

*Parent identity + CHIPS join-auth rules live in `SMART_WALLET_PLAN.md` §1.1 / §3.2. Do not expand 0a scope into 0b (sub-accounts, spend permissions, value).*
