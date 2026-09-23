# Smart Wallet Implementation Plan — Ludo Base

| Field | Value |
| --- | --- |
| **Project** | Ludo Base |
| **Document type** | Implementation plan — wallet/auth layer |
| **Decision** | Stay on Coinbase accounts (no custom wallet factory); integrate via CDP frontend stack |
| **Companion plans** | `docs/tokenomics/CHIPS_PLANNING.md` (§§4.6, 6.1, 8.7, 8.9) · `docs/planning/RECOMMENDED_IMPLEMENTATION_PLAN.md` |
| **Status** | Approved direction — **Phase 0a auth spike only** until the stable-build gate; CHIPS/sub-account rails stay gated |
| **Last updated** | 2026-09-24 |

---

## 0. Decision (locked)

- **No custom smart-wallet factory.** Accounts stay Coinbase Smart Wallets (Base Accounts): same address in our app, on web (`keys.coinbase.com`), and in the Base app.
- **One auth stack:** `@coinbase/cdp-hooks` (`CDPHooksProvider`, `createOnLogin: "smart"`, `enableSpendPermissions: true`). Do **not** run Base Account SDK + CDP embedded wallets as parallel account systems — users would end up with two different smart wallets. CDP supports "Sign in with Base" (`siwe:base`) linking, so Base-app users land in the same wallet.
- **Recovery stays Coinbase's** (passkey managers, email OTP, recovery phrase, linked backup methods). We never touch keys, seeds, or recovery flows.
- **Player identity is the parent Base Account.** See §1.1. Sub-accounts never appear as `wallet_address`.
- **CHIPS join authorization stays CHIPS_PLANNING §4.6.** Spend permissions are not the primary join path. See §3.

> **API surface note:** `CDPHooksProvider`, `createOnLogin: "smart"`, `siwe:base`, `wallet_addSubAccount`, `listSpendPermissions`, `useLinkOAuth`, `useCdpPaymaster` are **named targets to confirm in Phase 0a** against current CDP docs — not locked compile-time APIs. Nothing in `package.json` yet.

## 1. Why this works (same-account mechanics)

- A Base Account is deterministic from its owners: **same credentials → same account** everywhere. Nothing to sync, bridge, or export.
- Passkeys sync through the user's own cloud (iCloud Keychain / Google Password Manager) — the passkey created during our onboarding is the one the Base app sees.
- New user creating a wallet in our app = a real Smart Account on Base, visible in their Base app on next sign-in with the same method.
- Server **signature verification** needs zero changes: `lib/walletVerify.ts` / Edge `_shared/walletVerify.ts` already verify ERC-1271/6492 smart-contract signatures (`scripts/siwe-matrix.ts` proved real CBSW counterfactual sigs). SIWE text, EIP-712 grants, and match-record/host-proof formats are unchanged.
- Server **identity / linking** may still need work — see §1.2. "Zero changes" applies only to how signatures are checked.

### 1.1 Identity (locked)

| Rule | Detail |
| --- | --- |
| **Player id = parent Base Account address** | The only value allowed in `wallet_address`, `players`, friendships, `messages` / `players.ecdh_pubkey`, LXP/RXP, match seats, `live_matches.host_address`, claim/seat allowlists |
| **Sub-account = authorization convenience only** | May send gameplay txs with fewer popups; **must never** be recorded as the player, seat owner, host, claimer, or ECDH publisher |
| **Sign identity-bearing proofs as parent** | SIWE app session, match session EIP-712, move/pass/power/seed, match record, bet-resolve host proof, settle EIP-712, ECDH pubkey publish |
| **Sub-account re-register every session** | Ownership can change across devices/browsers; regenerating a sub is safe **only because** identity is not the sub |
| **CHIPS `seat = msg.sender`** | Join/claim txs must be parent-signed (or an explicitly parent-bound spend path). A sub-account seat would strand prizes on a regenerable account — loss bug |

If CDP's `defaultAccount: 'sub'` cannot sign as parent for personal_sign / EIP-712, **do not ship the sub default**. Phase 0a must prove "sign as parent" before any sub-account default is enabled.

### 1.2 EOA ↔ smart-wallet identity (product decision required)

CDP auto-linking merges Google ↔ same-email OTP **at Coinbase**. It does **not** merge a legacy MetaMask/injected EOA row with a new CDP Smart Account in our `players` table.

| Option | Meaning | Cost |
| --- | --- | --- |
| **A — New identity on CDP (default)** | Cutover creates a new `wallet_address`; old EOA history stays on the old row. Optional read-only export of stats | Documented break; no server merge code |
| **B — Account linking** | Explicit link flow (signed proof from both keys) so LXP/RXP/friends/DMs follow the player | Real server + UI work — contradicts "zero changes" |

**Default = A** unless product chooses B before Phase 1. Guests already have `migrateGuestStash` (`lib/guest.ts`); first CDP login from guest mode must run that migration against the **parent** address.

## 2. Auth methods

| Method | Status | Notes |
| --- | --- | --- |
| Device Google account | ✅ CDP Google OAuth | Coinbase-owned OAuth login; **auto-linking** merges Google ↔ same-email OTP accounts (no duplicates) |
| Apple | ✅ CDP OAuth | Same auto-linking (`@icloud.com`) |
| Facebook | ✅ CDP OAuth | Sign-in and post-login linking; same-email auto-linking where CDP supports it |
| X | ✅ `useLinkOAuth` | Sign-in and post-login linking |
| Telegram | ✅ CDP OAuth | Optional |
| Email OTP / SMS OTP | ✅ | 6-digit, 10/5-min expiry, rate-limited, up to 5 devices |
| Passkey (Sign in with Base) | ✅ | One passkey across every Base-enabled app |

Signup screen: **Continue with Google / Apple / Facebook / Email / Passkey** (X optional at signup, always linkable post-login). After first login, prompt a backup linked method.

**OAuth presentation (all social methods):** provider sign-in runs in the **user's default browser** (system browser / the tab that opened us) — never an in-app webview or our own captive browser. Flow: if the provider session cookie already exists in that browser → one-tap / silent confirm; if not → provider's login page in the same browser → return to app. **App handoff first (Google/Facebook/X/Apple app) is not a web-app control** — on web we use standard popup/redirect OAuth in the current default browser. Do not add deep-link-to-app wrappers. If a native shell is ever built, OAuth must use ASWebAuthenticationSession (iOS) / Chrome Custom Tabs or the default browser (Android), still not a WKWebView we own. Phase 0 spike verifies CDP's actual popup vs redirect behavior per provider.

## 3. Gameplay rails (sub-accounts + spend permissions)

### 3.1 Sub-accounts (auth convenience, not identity)

- `wallet_addSubAccount` at each session start (`creation: 'on-connect'`). App-scoped, owned by the parent — gameplay transactions with fewer approval popups.
- **Do not set `defaultAccount: 'sub'` for identity-bearing sign** until §1.1 is satisfied. Prefer parent-signed proofs always; use sub only for valueless/low-risk game txs that the parent has pre-authorized.
- Re-register every session (ownership may change across devices/browsers).

### 3.2 CHIPS join authorization (reconciled with CHIPS_PLANNING §4.6)

**CHIPS_PLANNING §4.6 remains authoritative.** This plan does **not** replace it with weekly spend-permission grants.

| Path | Status | Rules |
| --- | --- | --- |
| **Primary — EIP-5792 batch** `approve + joinPool` | **Authoritative** | Exact `entryFee`, short deadline, never infinite; one user approval; ERC-8021 `dataSuffix` on every call |
| **Fallback — sequential** `approve` → `joinPool` | Authoritative | Same exact-fee / short-deadline guarantees when the wallet cannot batch |
| **Fallback — EIP-2612 permit** | EOA-only | **Never** offered to smart-wallet users |
| **Spend permissions (optional later)** | **Not primary** | Only after an explicit CHIPS_PLANNING amendment. If ever used: user-set **cap**, **period ≤ 7d**, visible revoke (`listSpendPermissions` + UI), telemetry/alerts. Treat as the new permit-phishing surface — not "frictionless weekly allowance" as default product copy |

Conflict resolved: do **not** ship "one weekly CHIPS allowance grant, then frictionless entries" as the join model while §4.6 demands exact-fee/short-deadline. Exact-fee discipline wins until CHIPS freeze is amended in writing.

### 3.3 Gas / paymaster vs CHIPS §8.9

| Layer | Model | When |
| --- | --- | --- |
| Interim UX gas | CDP paymaster (`useCdpPaymaster` if it exists — confirm in 0a) | Sepolia spike / pre-8168 |
| Token economy gas | **ERC-8168 payer, gas only, never value** (`CHIPS_PLANNING` §8.9) | Contract-facing path |
| Session / scoped keys | **EIP-8130** (vibenet prototype) + existing EIP-712 match session | Contract-facing path (Phase 3) |

CDP sub-accounts + spend permissions = **app UX / auth convenience**. They are **not** a replacement for 8130 scoped keys or the 8168 payer on the CHIPS path. One model per surface; do not fork two competing session-key systems for the same on-chain join.

**Builder-code survival:** wagmi `dataSuffix` (`lib/builderCode.ts` → `Providers.tsx`) covers `useSendTransaction` / `useWriteContract` / `useSendCalls` only. If CDP/paymaster/sub-account sends outside wagmi, attribution is **silently lost** (CHIPS §8.7). Phase 0a/2 must prove every CDP tx path preserves the ERC-8021 suffix (and the B20 precompile M11 caveat).

## 4. Migration from today's wagmi setup

`app/Providers.tsx` currently uses `coinbaseWallet({preference:'smartWalletOnly'})` + injected/WalletConnect/MetaMask/safe + OnchainKit wallet UI. Feature-flagged cutover:

1. **Add** `CDPHooksProvider` alongside wagmi (existing connectors stay; EOAs keep working).
2. **Introduce one `useWalletSigner` (or thin adapter)** implementing `SignFn` / `SignTypedFn` — wagmi impl and CDP impl. **Do not** rewrite each call site against the CDP API.
3. **Rewire signing call sites** through the adapter (table below) — message formats unchanged.
4. **Sub-account + allowance UX** only in Phase 2 (gated).
5. **Cut over** default connect to CDP; replace OnchainKit `ConnectWallet` in `WalletConnectCard` explicitly (OnchainKit identity `useName` / `useAvatar` may stay). Legacy connectors one-release fallback; then remove.

### 4.1 Signing call-site inventory (complete)

| Site | Signs | Adapter-ready? |
| --- | --- | --- |
| `hooks/useAppSession.ts` | SIWE app session (chat/profile/settings) | Hard-depends on wagmi `useSignMessage` — swap to adapter |
| `hooks/useMoveAuth.ts` | Match session EIP-712 + move/pass/power/seed | **Yes** — already takes `SignFn` / `SignTypedFn` |
| `hooks/useGameEngine.ts` + `lib/matchRecorder.ts` | Match record | Injected `signMessage` — adapter |
| `hooks/TeamUpContext.tsx` | Injects signers into move auth | Wire adapter once here |
| `app/page.tsx` | Host stream proof + match record | Inline wagmi — move to adapter |
| `hooks/useDataActions.ts` | ECDH pubkey publish (`buildEcdhMessage`) | Inline wagmi — swap |
| `hooks/useSignedResolveBet.ts` | Bet-resolve host proof | Injected — adapter |
| `hooks/useSettlePool.ts` | Settle EIP-712 + `writeContract` | Inline wagmi — adapter + tx path |
| `hooks/useChipsPool.ts` | approve / join / claim `writeContract` | Phase 2 — adapter + tx path + `dataSuffix` |

App-session TTL is **7 days** (`APP_SESSION_TTL_MS` in `lib/sessionProof.ts`). Test matrix says **7-day re-auth** (not 30-day).

## 5. Phases (sequencing vs stable build)

Aligned with `docs/planning/RECOMMENDED_IMPLEMENTATION_PLAN.md`: **engine/gaps first**. Auth-only work is a thin carve-out; CHIPS value rails wait for the stable-build gate.

| Phase | Gate | Scope |
| --- | --- | --- |
| **0a — Auth spike (now, thin)** | During stable build | CDP project + `projectId` in **env** (never hardcoded); enable email/SMS/Google/Apple/Facebook/X + passkey; auto-linking ON; Base Sepolia target. Spike = **sign-in + parent-signed** SIWE + one EIP-712 match-session grant + personal_sign move proof. **No** sub-account default, **no** CHIPS spend permission, **no** Sepolia value playtest. Confirm SDK names, popup vs redirect, parent-sign with/without sub default, builder-code on CDP path if any tx |
| **0b — Sub-account + CHIPS spike** | **After stable-build gate** | `wallet_addSubAccount`, spend-permission read/revoke UX prototype, one CHIPS grant or exact-fee join on Sepolia (per §3.2). Record pass/fallback only |
| **1 — Auth cutover** | After 0a green | Provider wiring, signer adapter, linking UI, EOA↔smart decision (§1.2), guest→CDP migration checklist, multi-device + recovery matrix (passkey new-device sync, OTP expiry, **7-day** re-auth) |
| **2 — Gameplay rails** | After stable-build **and** CHIPS un-park | Sub-account per session (if §1.1 proven), join path per §3.2 (batch exact-fee primary), contracts track |
| **3 — Hardening** | After 2 | Revoke UX, allowance telemetry/alerts (if spend permissions ever ship), paymaster migration (CDP → own 8168), audit of any allowance defaults, 8130 prototype per CHIPS §8.9 |

**Not allowed during stable build** (same bar as RECOMMENDED §9): MatchPool/ClaimHub implementation, paid join/claim UI, settlement signer service, indexer, Sepolia value playtests, spend-permission product UX.

Record any un-park in `docs/ops/UNPARK_DECISION.md`.

### Phase 1 test matrix (corrected)

| Case | Expect |
| --- | --- |
| Passkey new-device sync (iCloud / Google PM) | Same parent address |
| OTP expiry (email 10m / SMS 5m) | Fail closed, re-send |
| **7-day** app-session re-auth | One SIWE; no popup loop |
| Parent sign with sub registered | SIWE/match/ECDH verify against parent |
| Sub regeneration across devices | History intact (identity ≠ sub) |
| Guest → first CDP login | `migrateGuestStash` to parent |
| EOA user (if still connected) | Unchanged paths via wagmi adapter |

## 6. Risks

| Risk | Mitigation |
| --- | --- |
| **CDP vendor dependence** (auth + paymaster + spend infra) | Standards-based accounts (ERC-4337, portable signers), swappable paymaster/RPC, Base Account SDK as fallback auth path |
| **Sub-account used as identity** (loss / orphaned claims) | §1.1 lock; code review gate; seat/claim asserts parent |
| **Spend-permission phishing** | Not primary join path (§3.2); if added later: cap + period ≤ 7d + revoke + telemetry |
| **EOA ↔ smart identity split** | Explicit §1.2 decision before Phase 1; default new identity |
| **Builder-code drop on CDP tx path** | Prove suffix on every send path in 0a/2 (CHIPS §8.7) |
| **Two session-key models** (CDP sub vs 8130) | §3.3 — CDP = UX, 8130/8168 = token economy |
| **SDK API drift** | Phase 0a confirm list; do not code against unverified names |
| **5-device limit** | Fine for a game; document it |
| **OAuth web-only** | Fine for web (§2). Frames (`FrameProvider`) already exist — if frames grow, use signed join-intents (CHIPS §4.6 note), never captive webview |
| **Hardcoded secrets in `Providers.tsx`** | OnchainKit `apiKey` + WC `projectId` fallback are in source today. Move all keys (incl. CDP `projectId`) to env; rotate OnchainKit key if live (CHIPS §8.8: never hardcode API keys) |

---

*Invariants (AGENTS.md, unchanged): SIWE never authorizes moves; match/record signature-gated; builder-code attribution on every tx; pull-only claims when contracts land. Teams/engine/Edge-RNG invariants untouched by this plan.*
