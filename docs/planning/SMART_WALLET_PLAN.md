# Smart Wallet Implementation Plan — Ludo Base

| Field | Value |
| --- | --- |
| **Project** | Ludo Base |
| **Document type** | Implementation plan — wallet/auth layer |
| **Decision** | Stay on Coinbase accounts (no custom wallet factory); integrate via CDP frontend stack |
| **Companion plans** | `docs/tokenomics/CHIPS_PLANNING.md` (§§4.6, 6.1, 8.7, 8.9) · `docs/planning/RECOMMENDED_IMPLEMENTATION_PLAN.md` |
| **Status** | Approved direction — Phase 0 spike next |
| **Last updated** | 2026-09-23 |

---

## 0. Decision (locked)

- **No custom smart-wallet factory.** Accounts stay Coinbase Smart Wallets (Base Accounts): same address in our app, on web (`keys.coinbase.com`), and in the Base app.
- **One auth stack:** `@coinbase/cdp-hooks` (`CDPHooksProvider`, `createOnLogin: "smart"`, `enableSpendPermissions: true`). Do **not** run Base Account SDK + CDP embedded wallets as parallel account systems — users would end up with two different smart wallets. CDP supports "Sign in with Base" (`siwe:base`) linking, so Base-app users land in the same wallet.
- **Recovery stays Coinbase's** (passkey managers, email OTP, recovery phrase, linked backup methods). We never touch keys, seeds, or recovery flows.

## 1. Why this works (same-account mechanics)

- A Base Account is deterministic from its owners: **same credentials → same account** everywhere. Nothing to sync, bridge, or export.
- Passkeys sync through the user's own cloud (iCloud Keychain / Google Password Manager) — the passkey created during our onboarding is the one the Base app sees.
- New user creating a wallet in our app = a real Smart Account on Base, visible in their Base app on next sign-in with the same method.
- Server side needs **zero changes**: `lib/walletVerify.ts` / Edge `_shared/walletVerify.ts` already verify ERC-1271/6492 smart-contract signatures; SIWE text, EIP-712 grants, and match-record/host-proof formats are unchanged.

## 2. Auth methods

| Method | Status | Notes |
| --- | --- | --- |
| Device Google account | ✅ CDP Google OAuth | Coinbase-owned OAuth login; **auto-linking** merges Google ↔ same-email OTP accounts (no duplicates) |
| Apple | ✅ CDP OAuth | Same auto-linking (`@icloud.com`) |
| X | ✅ `useLinkOAuth` | Sign-in and post-login linking |
| Telegram | ✅ CDP OAuth | Optional |
| Email OTP / SMS OTP | ✅ | 6-digit, 10/5-min expiry, rate-limited, up to 5 devices |
| Passkey (Sign in with Base) | ✅ | One passkey across every Base-enabled app |
| Discord | ❌ not a wallet signer | Link at **app layer** (own Discord OAuth → verified profile identity for social missions), same pattern as Farcaster identity |

Signup screen: **Continue with Google / Apple / Email / Passkey** (X optional at signup, always linkable post-login). After first login, prompt a backup linked method.

## 3. Gameplay rails (sub-accounts + spend permissions)

- **Sub-accounts:** `wallet_addSubAccount` at each session start (`creation: 'on-connect'`, `defaultAccount: 'sub'`). App-scoped, owned by the parent — gameplay transactions with no approval popups. Re-register every session (ownership may change across devices/browsers — documented gotcha, now checklist).
- **Funding:** CHIPS **spend permissions** (token + allowance + period, enforced on-chain by the Spend Permission Manager, revocable; read via `listSpendPermissions`, revoke exposed in UI) or manual transfers.
- **Effect on CHIPS UX:** pool entry goes from "approve + join per match" to "one weekly CHIPS allowance grant, then frictionless entries." Gas via `useCdpPaymaster` on Base/Base Sepolia until the own-8168 paymaster (§8.9) ships.
- Allowance defaults inherit the plan's exact-fee/short-deadline discipline — spend-permission amounts and periods are the new permit-phishing surface.

## 4. Migration from today's wagmi setup

`app/Providers.tsx` currently uses `coinbaseWallet({preference:'smartWalletOnly'})` + injected/WalletConnect/MetaMask/safe. Feature-flagged cutover:

1. **Add** `CDPHooksProvider` alongside wagmi (existing connectors stay; EOAs keep working).
2. **Rewire signing call sites** (`useAppSession` SIWE, `useMoveAuth` EIP-712 grants, match record/host proofs) to the CDP signer — message formats unchanged.
3. **Add** `wallet_addSubAccount` session init + CHIPS allowance grant UX (user-set cap + revoke button).
4. **Cut over** default connect button to CDP; legacy connectors as one-release fallback; then remove.

## 5. Phases

- **Phase 0 (decisions + spike, ~1 wk):** CDP project + `projectId`; enable email/SMS/Google/Apple/X; auto-linking ON; Base Sepolia target; spike = sign-in + sub-account + one CHIPS spend permission on Sepolia.
- **Phase 1 (auth cutover):** provider wiring, signing migration, linking UI, multi-device + recovery test matrix (passkey new-device sync, OTP expiry, 30-day re-auth).
- **Phase 2 (gameplay rails):** sub-account per session, allowance grant UX, route pool-entry intent through permission (contracts track), Discord app-layer linking.
- **Phase 3 (hardening):** revoke UX, allowance telemetry/alerts, paymaster migration (CDP → own 8168), audit of allowance defaults.

## 6. Risks

- **CDP vendor dependence** (auth + paymaster + spend infra). Mitigation: standards-based accounts (ERC-4337, portable signers), swappable paymaster/RPC, Base Account SDK as fallback auth path.
- **5-device limit** — fine for a game; document it.
- **OAuth web-only** — fine (web app).
- **Allowance defaults** — treat as phishing surface; exact-fee/short-deadline rules apply verbatim.

---

*Invariants (AGENTS.md, unchanged): SIWE never authorizes moves; match/record signature-gated; builder-code attribution on every tx; pull-only claims when contracts land.*
