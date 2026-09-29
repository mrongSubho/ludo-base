# Smart Wallet Planning — one wallet, one document

| Field | Value |
| --- | --- |
| **Project** | Ludo Base |
| **Document type** | Product + implementation plan — **the** wallet plan |
| **Consolidates** | `SMART_WALLET_PLAN.md` (CDP/auth technical notes) · `DUAL_PATH_WALLET_PLAN.md` (modes W0–W5) · `REAL_WALLET_PLAN.md` (wallet product R0–R5) — merged **2026-09-28** after all three recommendation tracks landed |
| **Status** | **Implemented** (W0–W5 + R0–R5 + hard QA 2026-09-28). Residual work in §12 |
| **Companions** | `docs/tokenomics/CHIPS_PLANNING.md` §4.6 / §8.7 / §8.9 · `docs/planning/RECOMMENDED_IMPLEMENTATION_PLAN.md` · `docs/planning/PHASE_0A_SPIKE_CHECKLIST.md` · `docs/tokenomics/CHIPS_PLANNING.md` |
| **Last updated** | 2026-09-28 |

> **Network (2026-09-28):** app runs on **Base Sepolia (84532) only** until mainnet launch. Wagmi / OnchainKit / WC / SIWE / match sessions all pin 84532. CDP swap (mainnet-only) is parked behind a “ships with Base mainnet” empty state.

One goal: **a real Web3 wallet that also plays Ludo** — see assets → send/receive → activity → connect dapps → stay in control (passkey / export), under dual-path auth (External **or** In-game).

---

## 0. Decisions (locked)

| Date | Decision |
| --- | --- |
| 2026-09-24 | No custom smart-wallet factory. Stay on Coinbase accounts (CDP + Base Account). |
| 2026-09-24 | CDP email/SMS/OAuth ≠ Base app wallet. Only `siwe:base` / Base Account passkey shares the Base app address. |
| 2026-09-24 | Parent-signed proofs only until sub-account default is proven (never ship `defaultAccount: 'sub'` for identity). |
| **2026-09-25** | **Dual-path:** External (Base Account / MetaMask / Phantom) **and** In-game CDP Smart Account. One active `wallet_address` per session. Optional link later. |
| **2026-09-25** | Passkey = **MFA after** login (not primary sign-in). Export = Coinbase secure iframe → **owner EOA** key. No seed import. |
| **2026-09-25** | Mode B = **CDP Smart Account**. Third-party dapps use **Ludo as WalletConnect wallet** (not “export to MetaMask to show 0x221A…”). |
| **2026-09-25** | CHIPS join stays **CHIPS_PLANNING §4.6** exact-fee batch — **not** weekly spend-permissions as default. |
| **2026-09-25** | **Real wallet product:** Home + Send/Receive + Activity first; CHIPS stays modules; CHIPS **unpriced** in USD totals (H2). |
| **2026-09-25** | Swap = CDP `useGetSwapPrice` / `useSwap` (Coinbase engine, Base only). Buy = Onramp deep link. **No NFT tab** (Marketplace owns NFTs). |
| **2026-09-25** | Safety: `peekAppSession` for pollers; sign only on user gesture; WC denylist + inbox decode; unlimited-approve banners. |
| **2026-09-28** | Remote push (VAPID + SW) shipped; WC session expiry countdown; searchable Base swap list. |
| **2026-09-29** | Boot unlock = WebAuthn passkey MFA (not social re-login). Strict tx = passkey/device bio required. Settings: auto-approve sign-in · confirm-tx-without-passkey. |

**API surface (verified 2026-09-24):** `@coinbase/cdp-hooks` / `cdp-core` / `cdp-react`. `CDPHooksProvider` with `ethereum.createOnLogin: "smart"`. SIWE: `useSignInWithSiwe` / `siwe:base` (+ `@base-org/account`). OAuth: Google / Apple / X / Telegram — **Facebook is not in CDP**. Spend perms exist (0b+ only). `useCdpPaymaster` is a send boolean, not a hook.

---

## 1. Product goal & success criteria

> **See what I have → send/receive → know what happened → connect to apps → stay in control of security.**

| # | Criterion | Status |
| --- | --- | --- |
| 1 | Receive ETH/USDC/CHIPS and send them without leaving Ludo | ✅ R0–R1 |
| 2 | Activity lists transfers / joins / claims / burns with explorer links | ✅ R1 |
| 3 | Passkey / Touch ID as security gesture after email/Google | ✅ W1 + R2 |
| 4 | Connect to a dapp (WalletConnect) from wallet home | ✅ W5 + R3 |
| 5 | External and In-game modes on the same wallet IA | ✅ W1–W3 |
| 6 | No wallet-only dead ends: every balance has Send / Receive / Details | ✅ |
| 7 | New user: email OTP → play with zero extension and zero keys.coinbase.com popup | ✅ W1 |
| 8 | Site load / DM open never opens a wallet | ✅ W2 |
| 9 | CHIPS never priced into USD totals | ✅ H2 |
| 10 | One `wallet_address` per session; never owner EOA / sub as id | ✅ |

---

## 2. Dual-path modes

| Mode | Who it’s for | `wallet_address` | Sign UX | Popups |
| --- | --- | --- | --- | --- |
| **A · External** | Base app / MetaMask / Phantom users | Connected EOA or Base Smart Account | Their wallet | Their popups; `appName`/`appLogoUrl` on Base |
| **B · In-game** | “Just let me play” | **CDP Smart Account** (`0x221A…` class, project-scoped) | Our Ludo UI + WC wallet for dapps | Almost none in-game |

### Arena entrance

```text
┌─────────────────────────────────────┐
│  Ludo Base · Arena Entrance         │
│  [ Continue with Base ]     ← A     │
│  [ MetaMask ] [ Phantom ]   ← A     │
│  ── or ──                           │
│  [ Create in-game wallet ]  ← B     │
│     email / Google / Apple / X      │
│  [ Continue as Guest ]              │
└─────────────────────────────────────┘
```

In-game copy always says: **“In-game wallet · not your Base app wallet.”**

| Last mode | Returning gate |
| --- | --- |
| External | “Continue as 0xabc…” → user-gesture connect |
| In-game | “Continue as you@email” → CDP session restore |
| Both | Two chips; pick one → that mode is `wallet_address` for the session |

### What we refuse

- Swapping `wallet_address` mid-match.
- Persisting CDP owner EOA or sub-account as `wallet_address`.
- Treating in-game smart address as Base app address in copy.
- Silent identity swap when the in-game session lapses (`needsReconnect` UI instead).

---

## 3. Identity (locked)

```text
session.wallet_address = mode === 'external' ? connectedAddress : cdpSmartAccount
```

| Rule | Detail |
| --- | --- |
| **One active id per session** | Never both rows without explicit link (W3) |
| **In-game ≠ Base app** | Copy + `WalletDetailsSheet` say so |
| **Sub-account** | Never id / seat / host / claim / ECDH |
| **Sign proofs as parent/smart** | SIWE, match EIP-712, moves, record, ECDH via `usePlayerSigner()` |
| **CHIPS `seat = msg.sender`** | Must equal active `wallet_address` |
| **Guest migration** | `migrateGuestStash` on first successful bind (either mode) |

**Account linking (W3, optional):** two signatures → `wallet_links`. Progression **not** auto-merged (`progressionMerged: false`). CHIPS funds never move on link.

**EOA ↔ smart split:** CDP auto-linking (Google ↔ same-email OTP) is Coinbase-side only. It does not merge a legacy MetaMask row with a new CDP smart. Default = **new identity** on CDP; optional read-only export of old stats.

---

## 4. Signing architecture

```text
                    ┌── useWalletSigner (wagmi) ──── External EOA / Base
usePlayerSigner() ──┤
                    └── useCdpParentSigner ───────── In-game CDP smart
                           │
                           └── CBSW 1.1 / 0xba5ed110… 6492 wrap when needed
```

| Proof | External | In-game CDP |
| --- | --- | --- |
| Ludo SIWE (`/api/siwe/verify`) | wallet `personal_sign` | parent smart + 6492 |
| Match EIP-712 | wallet `signTypedData` | parent smart / wrap |
| ECDH publish | once per address | once per CDP address |
| Match record / host | wallet | parent smart |
| CHIPS tx | wagmi batch / `writeContract` | `useCdpUserOp` `sendUserOperation` + `dataSuffix` |

Server verify path unchanged: `lib/walletVerify.ts` is 1271/6492-ready.

### Popup policy (signing-storm rules)

| Context | Rule |
| --- | --- |
| Boot / DM open / presence / inbox poll | `peekAppSession` **only** — never opens a wallet |
| User click (send / match / accept / poke) | `ensureAppSession` + signer |
| ECDH publish | first Send only (`ludo-ecdh-published-*`) |
| Base Account connect | Direct click; nonce prefetch so the popup opens on gesture |

App-session TTL is **7 days** (`APP_SESSION_TTL_MS`). SIWE app session is for chat/profile/settings — **never** match moves (match uses EIP-712 `LudoMatchSession` / Edge `move-auth`).

---


### Mode gates (wallet surfaces)

| Surface | External | In-game |
| --- | --- | --- |
| Send / Receive / Activity / Dapps (WC) | ✅ | ✅ |
| Notifications (push) | ✅ | ✅ |
| Buy (Onramp) | ✅ | ✅ |
| **Passkey MFA** | ❌ hidden | ✅ CDP MFA |
| **Export private key** | ❌ hidden | ✅ owner EOA iframe |
| **Link wallets** | ❌ hidden | ✅ |
| **Swap (CDP engine)** | ❌ empty-state hint | ✅ |
| Send step-up MFA | no-op (wallet owns auth) | ✅ passkey if enrolled |

External wallets own their security (extension / Base app). We never re-skin that as passkey/export.

### Post-create flow (in-game)

| Case | UX |
| --- | --- |
| **First create** (email OTP / social) | Wallet ready → security ladder → passkey nudge (skippable) → arena. **No private key at create** (export = Security only). |
| **Returning · live CDP session** | Silent restore — no picker sheet |
| **Returning · seen ready before** | “Welcome back · 0x…” → Continue to arena |
| **Lobby** | `Wallet · Protect · Play` ladder chip |

### Boot unlock — what “CDP passkey” means

On launch, if a **passkey is enrolled** on the CDP account (or the user turned on *Unlock every launch*), `BootLock` shows **Welcome back → Unlock**.

| | Meaning |
| --- | --- |
| **CDP passkey** | Local **WebAuthn MFA** (Face ID / Touch ID / Windows Hello / security key) enrolled via Security → Passkey after login |
| **Not** | Re-login with Google / Apple / X / OTP |
| **Session** | Email/OAuth CDP session stays alive; Unlock is device proof only |
| **No passkey** | Fallback: platform authenticator (`navigator.credentials.get`) when supported |

Google/Apple/X/OTP appear only if the **CDP login session expired** — that is Arena Entrance sign-in, not Unlock.

### Sign-in vs transaction approval (CDP)

**Consent is always a click.** “Background” = the **crypto sign** (CDP API / TEE), never silent value movement.

| Event | User gesture | What they see | Crypto sign |
| --- | --- | --- | --- |
| Match start / app session / first DM | Click Start / Send | Usually nothing extra (or one Confirm line) | CDP API — no wallet popup |
| Pollers (boot, DM open, presence) | None | Nothing (`peekAppSession` only) | Never |
| Send / Swap / CHIPS join | Review → **Confirm** | Ludo confirm sheet | CDP API after step-up |
| Passkey enrolled (strict tx) | Confirm + **Face ID / Touch ID** | OS biometric | Then CDP API |
| **Strict tx without passkey/bio** | — | **Blocked** | Not sent |
| External wallet | Same Ludo confirm | **+ their extension / keys.coinbase.com popup** | In the wallet |

App-session TTL is **7 days**. Match path is EIP-712 `LudoMatchSession` (not SIWE-as-move-auth).

### Security preferences (Settings → Security)

| Pref | Default | Behavior |
| --- | --- | --- |
| **Unlock every launch** | on | `BootLock` when a **CDP passkey is enrolled** (server state — never localStorage) |
| **Auto-approve sign-in** | on | CDP signs match/DM messages without extra prompts; **off** requires device bio before that sign |
| **Confirm txs without passkey** | off | Opt-in **CDP auto-approve** for tx: Ludo Confirm only |
| **Strict tx (default)** | — | Send/swap require **passkey or device Face ID/Touch ID**; otherwise refuse |

### Device gates (product lock)

| Gate | Credential |
| --- | --- |
| **Boot** | CDP **passkey** (enrolled) |
| **Tx approval** | **Device unlock** — fingerprint · Face ID · device PIN · pattern |
| **Login** | Rare (session restore; only when expired or signed out) |

### Passkey model (security)

| Layer | What is stored |
| --- | --- |
| **CDP server** | credential id + **public key** + “MFA enrolled” on the account |
| **Device / platform** | **private key** (Touch ID / Face ID / security key; Apple/Google sync) |
| **Never** | seed / private key on Ludo or CDP application servers |

**Multi-device (same Google / Apple / X):** OAuth sign-in works from any device. **Unlock / tx step-up still need a passkey the device can use** (iCloud Keychain, Google Password Manager, or a security key). Stolen cookie alone is not enough.

**Unlock binding:** **CDP MFA is source of truth** when a passkey is enrolled (`initiateMfaVerification` / passkey). Local `navigator.credentials.get` (our origin RP) is the **device fallback**. Fail closed if neither completes.

**RP / origin:** a passkey is bound to the **RP id** (site origin). A credential saved on `ludobase.live` cannot assert on `localhost` — use production (or skip lock on localhost dev only). Mobile often works via CDP’s hosted ceremony (Coinbase RP + Google/iCloud sync).

**Do not** gate on localStorage (`hasSeenWalletReady` is UX only). Clearing site data must not disable the lock.

Code: `hooks/useSecurityPrefs.ts` · `useMfaStepUp` · `BootLock` · `useAppSession` (autoSign gate).

**Boot lock security:** gate on **CDP-enrolled passkey** (server) only. Clearing cookies/localStorage must not disable the lock; `markBootUnlocked()` only skips the create → ready handoff in the same document.

## 5. Wallet product (IA)

```text
Wallet (WalletShell)
├── Home        mode chip · USD total (priced only) · ETH · USDC · CHIPS (unpriced) · Send/Receive/Buy
├── Send        native ETH + ERC-20 (USDC / CHIPS)
├── Token       token send sheet
├── Receive     QR + copy + mode warning
├── Swap        CDP swap engine · Base · searchable token list
├── Activity    unified list + BaseScan · linked wallets
├── Apps        WalletConnect wallet (W5) + request inbox
└── Security    passkey MFA · export key · remote push · wallet details · link/switch
```

| Area | Implementation |
| --- | --- |
| **Balances** | `hooks/useWalletAssets.ts` — ETH / USDC / CHIPS; CHIPS `unpriced: true` |
| **Send** | `useSendNative` (max = balance − gas on self-pay) · `useSendToken` · MFA step-up |
| **Swap** | `SwapSheet` + `lib/swapTokens.ts` (15 Base tokens, searchable). CHIPS **not** listed |
| **Buy** | Coinbase Onramp deep link (`BuyCryptoButton`) |
| **Activity** | `useWalletActivity` + `WalletActivityList` |
| **Receive** | `ReceiveSheet` — QR, copy, in-game warning |
| **Details** | `WalletDetailsSheet` — smart vs owner EOA vs Base app |
| **Export** | `useExportEvmAccount` → Coinbase iframe → owner EOA key (MFA-gated) |
| **Passkey** | `WalletSecurityPanel` enroll/list/delete + `useMfaStepUp` on send/export |
| **Biometrics** | `useBiometricGate` — local WebAuthn lock before wallet (skippable) |
| **PWA** | `app/manifest.ts` · `public/sw.js` · `QrScanButton` |
| **Push** | `usePushReady` · `/api/push/subscribe|test` · `push_subscriptions` · VAPID |

**Deep link** `ludo://pay?`: strict address/token validation when wired.

---

## 6. Security hard requirements

### H1 — Request inbox must not enable blind value movement

| Requirement | Spec | Status |
| --- | --- | --- |
| Decoded call summary | `to`, `value`, function, token amount (transfer / approve / joinPool / claimMatch) | ✅ `lib/wcDecode.ts` |
| Unlimited approve | red banner + “reject and set exact allowance on dapp” | ✅ |
| Value-at-risk | Σ native `value` + decoded token transfers | ✅ |
| Session method scope | allowlist + **denylist** `eth_sign`, `eth_signTransaction`, `wallet_addEthereumChain`, `wallet_switchEthereumChain`, arbitrary `wallet_*` | ✅ `WC_DENIED_METHODS` |
| Chain gate | `isAllowedChain` **fails closed** on missing `chainId` | ✅ |
| `personal_sign` params | both `[message, address]` and `[address, message]` | ✅ |
| Phishing | peer origin domain prominent (metadata self-asserted) | ✅ |
| Simulation | `eth_call` when RPC allows | ⬜ residual |

### H2 — Total value must not price CHIPS
Unpriced badge; excluded from USD total; structurally omitted from swap list and other chains.

### M — Lifecycle & identity

| Item | Spec | Status |
| --- | --- | --- |
| UserOp status | `submitted → bundled → confirmed/failed`; never label UserOp hash as plain tx | ✅ |
| Paymaster reject | fall back to self-pay or explicit “gas sponsorship unavailable” | ✅ |
| Identity switch | `needsReconnect` UI; never quiet swap to external | ✅ |
| Max send | branch by gas path (self-pay = balance − gas) | ✅ |
| CHIPS multi-chain | Base-only; lists omit CHIPS elsewhere | ✅ |
| WC sessions | expiry countdown, per-session chain scope, **Disconnect all** | ✅ `lib/wcExpiry.ts` |
| Push auth | `requireAppSession`; RLS service-only; `VAPID_PRIVATE_KEY` server-only | ✅ |

---

## 7. CHIPS / economy rules (both modes)

**CHIPS_PLANNING §4.6 is authoritative.** This plan does not replace exact-fee joins with spend permissions.

| Path | Status | Rules |
| --- | --- | --- |
| **Primary — EIP-5792 batch** `approve + joinPool` | Authoritative | Exact `entryFee`, short deadline, never infinite; `dataSuffix` (ERC-8021) |
| **Fallback — sequential** | Authoritative | Same exact-fee discipline |
| **EIP-2612 permit** | EOA-only | Never offered to smart-wallet users |
| **Spend permissions** | Not primary | Only after written CHIPS_PLANNING amendment (cap, period ≤ 7d, visible revoke) |

| Rule | External | In-game |
| --- | --- | --- |
| `wallet_address` = seat | Connected wallet | CDP smart |
| `joinPool` `msg.sender` | Same | Same |
| Approve / batch | wagmi `useSendCalls` | `useCdpUserOp` + paymaster flag |
| Gas | User / future ERC-8168 | CDP paymaster interim only |

Guest wallets blocked on paid tables. Offline/bot play stays free (local `processMove`).

**Builder code:** `dataSuffix` on every send path (`lib/builderCode.ts`). CDP UserOp path must preserve it (`hooks/useCdpUserOp.ts`) — proven in W4.

**Session keys:** CDP sub-accounts / spend perms = app UX only. Token-economy keys stay **EIP-8130** (vibenet prototype) + **ERC-8168** payer per CHIPS §8.9. One model per surface.

---

## 8. Ludo as WalletConnect wallet (portability)

```text
Third-party dapp (Uniswap, …) ──wc: URI──▶ Ludo (WalletKit, wallet role)
                                              │ approve session / requests
                                              ▼
                                    active wallet_address (CDP smart or external)
```

| Item | Spec |
| --- | --- |
| Protocol | Reown **WalletKit** (`lib/wcWallet.ts`) |
| Chains v1 | `eip155:8453` + `eip155:84532` only |
| Sign path | `usePlayerSigner` (CDP smart or external) |
| UX | Paste `wc:` · QR · `/wc?uri=` · camera scan |
| Security | **Never auto-approve**; decode + value-at-risk + unlimited-approve banner; rate-limit; user gesture |
| Sessions | Live expiry countdown, disconnect one / all |
| Batch | Prefer EIP-5792 / UserOp when dapp supports |
| Out of scope v1 | Solana WC · multi-chain · browser extension |

| Portability | Path |
| --- | --- |
| Third-party dapps | **WalletConnect wallet** — primary |
| Raw key / cold exit | Export owner EOA (MetaMask shows EOA only) |
| External-native users | Mode A (their own wallet) |

---

## 9. Auth methods (In-game)

| Method | Status | Notes |
| --- | --- | --- |
| Email OTP / SMS OTP | ✅ | 6-digit; email 10m / SMS 5m expiry; ~5 devices |
| Google / Apple | ✅ CDP OAuth | Auto-linking same-email at Coinbase |
| X / Telegram | ✅ CDP OAuth | Telegram optional |
| Facebook | ⛔ not in CDP | Do not advertise |
| Passkey | ✅ MFA only | After login; protects sign/send/export |
| Sign in with Base | ✅ Mode A | `siwe:base` / Base Account passkey |

OAuth runs in the **user’s default browser** (popup/redirect) — never an in-app webview we own.

---

## 10. Implementation map

| Concern | Code |
| --- | --- |
| Mode switch | `lib/walletMode.ts` · `hooks/usePlayerSigner.ts` |
| Identity | `lib/playerIdentity.ts` |
| Signer seam | `lib/walletSigner.ts` · `useWalletSigner` · `useCdpParentSigner` · `useBaseAccountSigner` |
| App session | `hooks/useAppSession.ts` (`peek` / `ensure`) · `lib/appSessionGuard.ts` |
| UserOp + paymaster | `hooks/useCdpUserOp.ts` · `lib/paymaster.ts` |
| Assets / send / activity | `useWalletAssets` · `useSendNative` · `useSendToken` · `useWalletActivity` |
| Swap / buy | `lib/swapTokens.ts` · `SwapSheet` · `BuyCryptoButton` |
| WC wallet | `lib/wcWallet.ts` · `lib/wcDecode.ts` · `lib/wcExpiry.ts` · `WcWalletPanel` |
| Security | `useMfaStepUp` · `useBiometricGate` · `WalletSecurityPanel` · `WalletDetailsSheet` |
| Push / PWA | `usePushReady` · `lib/pushServer.ts` · `app/api/push/*` · `public/sw.js` · `app/manifest.ts` |
| Link wallets | `lib/walletLink.ts` · `app/api/wallet-links` · migration `202609250001_wallet_links.sql` |
| CHIPS rails | `useChipsPool` · `useSettlePool` · `lib/chips.ts` |
| Shell UI | `app/components/WalletShell.tsx` + sheets/panels |

**Env:** `NEXT_PUBLIC_CDP_PROJECT_ID` · `NEXT_PUBLIC_CDP_AUTH` · `NEXT_PUBLIC_WALLET_INGAME` · `NEXT_PUBLIC_WC_PROJECT_ID` · `NEXT_PUBLIC_VAPID_PUBLIC_KEY` · `VAPID_PRIVATE_KEY` (server) · `VAPID_SUBJECT`.

---

## 11. Phase status (all landed)

| Slice | Scope | Status |
| --- | --- | --- |
| **0a** | CDP auth spike (checklist `PHASE_0A_SPIKE_CHECKLIST.md`) | ✅ GREEN |
| **W0** | Decision & contracts (docs) | ✅ 2026-09-25 |
| **W1** | In-game vertical slice: OTP/Google → smart · `usePlayerSigner` · passkey MFA · export | ✅ |
| **W2** | External polish: Base/MM/Phantom gate · nonce prefetch · peek-only boot | ✅ |
| **W3** | Optional link (2-sig) + mode switcher; no progression merge | ✅ |
| **W4** | Mode-aware CHIPS join/claim · UserOp + `dataSuffix` | ✅ |
| **W5** | Ludo = WalletConnect wallet · request inbox · QR | ✅ |
| **R0** | WalletShell · Receive · Send ETH | ✅ |
| **R1** | Tokens + unified activity | ✅ |
| **R2** | Passkey step-up · wallet-details | ✅ |
| **R3** | Apps tab · inbox decode · disconnect all · session countdown | ✅ |
| **R4** | Swap (CDP) · Onramp buy · Base-only · no NFT tab | ✅ |
| **R5** | QR · remote push · biometrics gate · PWA | ✅ |
| **QA** | Hard QA 2026-09-28 (see §13) | ✅ |

---

## 12. Residual work (not blocking)

1. **ABI decode** beyond transfer/approve/joinPool/claimMatch (H1 completeness).
2. **eth_call simulation** in the WC inbox when RPC allows.
3. **Production push:** apply `supabase/migrations/202609280001_push_subscriptions.sql`; set VAPID keys; wire turn/claim nudges (`sendPushToWallet` is ready).
4. **CDP Portal manual steps:** passkey MFA ON + CORS origin allowlist.
5. **Device QA:** phone biometrics, WC→Uniswap, Sepolia join/claim/export.
6. **0b / Phase 3** (still gated by CHIPS un-park): sub-account spike, spend-perm UX, own ERC-8168 paymaster, EIP-8130 session keys (`CHIPS_PLANNING` §8.9).
7. **Address book** / `ludo://pay` deep link (optional).
8. **Remote push nudges** product (turn / claim) — storage + send path exist; event triggers not wired.

---

## 13. Hard QA (2026-09-28)

| Area | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npx eslint app hooks lib` | clean (wallet surface burn-down) |
| `npm test` | 91/91 pass |
| `npm run check:engine` | Edge engine in sync |
| `npm run build` | ok — `/api/push/*` registered |
| Identity | `wallet_address` = SIWE/Base or CDP smart only |
| CHIPS H2 | unpriced badge; out of USD total; out of swap list |
| WC H1 | denylist · fail-closed chain · unlimited-approve · value-at-risk · origin |
| Signing storm | pollers `peek`; `ensure` only on gesture |
| Push | `requireAppSession` · RLS service-only · private key server-only |
| Swap addresses | CoinGecko Base list verified; VIRTUAL/ZORA corrected; wstETH = Lido `0xc1CBa3fEA344f73F911E4546C687288E5F2636A1` |
| WC expiry | live countdown · amber <1h · red expired |

---

## 14. Risks

| Risk | Mitigation |
| --- | --- |
| Users treat In-game smart as Base app | Copy + `WalletDetailsSheet` + receive warning |
| CDP vendor lock | External path remains full exit; exportable owner key; standards accounts |
| Sub-account as identity | Locked out of `wallet_address` / seat / claim |
| Spend-permission phishing | Not the join path; amendment required |
| Popup storm regression | Keep `peekAppSession` discipline; QA §13 |
| Blind WC approve | H1 inbox + denylist + risk banners |
| CHIPS mispriced | H2 unpriced; never invent a price |
| Builder-code drop | `dataSuffix` on every send path incl. UserOp |
| Two session-key models | CDP = UX; 8130/8168 = token economy |
| Hardcoded API keys | All keys in env (incl. CDP `projectId`) |

---

## 15. Legacy map (old filenames)

Old section numbers cited in code comments / older docs:

| Old citation | Where it lives now |
| --- | --- |
| `SMART_WALLET_PLAN` §1.1 identity | this doc §3 |
| `SMART_WALLET_PLAN` §3.2 CHIPS join | this doc §7 |
| `SMART_WALLET_PLAN` §5 phases 0a–3 | this doc §11 + §12 residual 6 |
| `DUAL_PATH_WALLET_PLAN` §3–4 identity/signing | this doc §3–§4 |
| `DUAL_PATH_WALLET_PLAN` §5.4–5.5 passkey/export | this doc §5 + §9 |
| `DUAL_PATH_WALLET_PLAN` §5.7 / W5 WC wallet | this doc §8 |
| `DUAL_PATH_WALLET_PLAN` W0–W5 | this doc §11 |
| `REAL_WALLET_PLAN` §2–3 IA/flows | this doc §5 |
| `REAL_WALLET_PLAN` §7b H1/H2/M | this doc §6 |
| `REAL_WALLET_PLAN` R0–R5 | this doc §11 |

---

*Invariants (AGENTS.md, unchanged): SIWE never authorizes moves; match/record signature-gated; Edge RNG; builder-code on every tx; pull-only CHIPS claims; teams/engine rules untouched.*
