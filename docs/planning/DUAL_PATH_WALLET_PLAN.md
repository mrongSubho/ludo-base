# Dual-Path Wallet Plan — External Wallet + In-Game CDP Wallet

| Field | Value |
| --- | --- |
| **Project** | Ludo Base |
| **Document type** | Product + implementation plan — wallet modes |
| **Decision** | **Two first-class modes:** (1) **External wallet** (Base Account / MetaMask / Phantom) for users who want their own wallet; (2) **In-game CDP wallet** (email/Google/Apple/X) — fully themed, Coinbase-custodied keys, no extension required |
| **Supersedes** | Identity-only-Base-Account lock in `SMART_WALLET_PLAN.md` §1.1 (Option A alone). Recovery of “Option C dual-id risk” is solved by **mode = one wallet per session** (see §3) |
| **Companion** | `SMART_WALLET_PLAN.md` · `PHASE_0A_SPIKE_CHECKLIST.md` · `CHIPS_PLANNING.md` §4.6 |
| **Status** | **Approved** — Mode B = **CDP Smart Account** + **Ludo = WalletConnect wallet** (portability). Implement W1 → W5 |
| **Last updated** | 2026-09-25 |

---

## 0. Product decision (locked)

Users pick **how they play**, not “which chain address class”:

| Mode | Who it’s for | Identity (`wallet_address`) | Sign UX | Popups |
| --- | --- | --- | --- | --- |
| **A · External wallet** | Base app / MetaMask / Phantom users | Connected EOA or Base Smart Account | **Their** wallet (keys.coinbase.com, MM, Phantom) | Their popups + our `appName`/`appLogoUrl` on Base |
| **B · In-game wallet** | “Just let me play” / no extension | **CDP Smart Account** `0x221A…` (project-scoped CBSW) | **Our** Ludo UI + **Ludo as WalletConnect wallet** for third-party dapps | Almost none in-game; WC QR/URI for other dapps |

**Not a fork of player progression unless the user links (optional, later).**  
Default: **one active wallet per session** = the only `wallet_address` we write.

---

## 1. Why this is better than “Base only” or “CDP only”

| | Base / external only | CDP only | **Dual-path (this plan)** |
| --- | --- | --- | --- |
| Base app address parity | ✅ | ❌ | ✅ when user picks External |
| Zero-friction onboard (email) | ❌ | ✅ | ✅ when user picks In-game |
| Full UI white-label | Partial (popup is Coinbase) | ✅ login + sign | ✅ for In-game; External keeps their wallet |
| CHIPS `seat = msg.sender` | Clear | Clear if same wallet signs txs | Clear **per mode** (§6) |
| Risk | Drop non-crypto users | Wrong address vs Base app | Two modes to document; no silent mix |

---

## 2. UX flows

### 2.1 Arena entrance (replace single “Sign in to start” modal)

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

- **External:** existing `LudoWalletModal` paths (`baseAccount` / injected / WC).
- **In-game:** CDP `CDPHooksProvider` (or `CDPReactProvider`) — our modal, our buttons.
- Copy on B: “In-game wallet · sign in with email · not your Base app wallet” (honest, one line).

### 2.2 Returning users

| Last mode | Gate behavior |
| --- | --- |
| External | “Continue as 0xabc…” → `wallet_connect` / injected connect (user gesture) |
| In-game | “Continue as you@email” → CDP session restore (no popup if session live) |
| Both used before | Show **two chips**; pick one → that mode’s wallet becomes `wallet_address` for the session |

### 2.3 In-game wallet moments (B)

| Action | UX |
| --- | --- |
| First email/Google | Our form → OTP (branded mail) → CDP user + smart account |
| SIWE app session / match EIP-712 | Silent or one “Confirm in Ludo” sheet — **not** keys.coinbase.com |
| CHIPS join / tx (later) | Our CTA → CDP `sendUserOperation` / paymaster |
| Export key | Coinbase secure iframe (only external chrome) |

### 2.4 External wallet moments (A)

Same as today: their popups; our `appName` + `appLogoUrl` on Base Account; wagmi for MM/Phantom.

---

## 3. Identity & data model (no silent mix)

### 3.1 One active wallet per session

```text
session.wallet_address = mode === 'external' ? connectedAddress : cdpSmartAccount
```

- Never write both into `wallet_address` on the same row without an explicit link (§3.3).
- UI display: **one** address chip — the active mode’s parent/smart address (not owner EOA, not CDP sub).

### 3.2 Schema (additive)

| Column / table | Purpose |
| --- | --- |
| `players.wallet_address` | Unchanged PK — **active mode** address |
| `players.wallet_mode` | `'external' \| 'ingame' \| 'linked'` (nullable → treat as external) |
| `wallet_links` (optional, Phase W3) | `(primary_wallet, linked_wallet, link_type, created_at)` — only for users who opt in |
| ECDH / sessions / seats | Keyed by **active** `wallet_address` as today |

CDP embedded smart account = **one** address (`evmSmartAccountObjects[0]`). Never persist the owner EOA or sub-account as `wallet_address` (still §1.1 of SMART_WALLET_PLAN).

### 3.3 Optional link (Phase W3 — not required for launch)

- “Link another wallet” in Settings: prove both addresses (two signatures) → `wallet_links`.
- Progression merge policy: **max(LXP/RXP)** or **sum-with-cap** — product call before implement; default **do not merge** at launch (two profiles if they play both unlinked).
- CHIPS funds **do not** auto-move on link.

### 3.4 What we refuse

- Swapping `wallet_address` mid-match.
- Using CDP EOA owner as id.
- Treating in-game address as Base app address in copy.

---

## 4. Signing architecture

### 4.1 Single seam (already started)

`lib/walletSigner.ts` + `hooks/useWalletSigner.ts` (wagmi) + `hooks/useCdpParentSigner.ts` / `useBaseAccountSigner.ts`.

```text
                    ┌── useWalletSigner (wagmi) ──── External EOA / Base
usePlayerSigner() ──┤
                    └── useCdpGameSigner ─────────── In-game CDP smart
```

**Recommend:** one hook `usePlayerSigner()` that returns the **active mode** signer + `address`, selected by `wallet_mode` / connect state. Call sites (SIWE, match session, ECDH, match record) stay DI-style (`signMessageAsync` / `signTypedDataAsync`).

### 4.2 Per-mode sign matrix

| Proof | External | In-game CDP |
| --- | --- | --- |
| Ludo SIWE (`/api/siwe/verify`) | personal_sign via wallet | `useSignEvmMessage` **or** CBSW 1.1 wrap if needed |
| Match EIP-712 | wallet `signTypedData` | `useSignEvmTypedData` / wrap |
| ECDH publish | once per address | once per CDP address |
| Match record / host | wallet | CDP parent smart |
| CHIPS tx | wallet `sendCalls` / `writeContract` | CDP `sendUserOperation` (+ later paymaster) |

Server: **zero change** to verify path (`walletVerify` already 1271/6492).

### 4.3 Popup policy (from storm fix)

| | External | In-game |
| --- | --- | --- |
| Boot / DM open | `peekAppSession` only | same |
| User click (send / match) | `ensureAppSession` + their wallet | `ensureAppSession` + CDP silent sign |
| wallet_connect | Direct click, branded | N/A (CDP login) |

---

## 5. In-game CDP wallet (Mode B) — detailed

### 5.1 Stack

| Piece | Choice |
| --- | --- |
| SDK | `@coinbase/cdp-hooks` + `@coinbase/cdp-core` (already in tree) |
| Provider | `CDPHooksProvider` — **`createOnLogin: "smart"`**; **do not** set `defaultAccount: 'sub'` |
| Identity | `evmSmartAccountObjects[0]` |
| Auth methods | Email OTP (primary), Google / Apple / X (CDP OAuth); **Telegram optional**; **Facebook not in CDP** |
| Branding | Our full Ludo modal + CDP Portal OTP logo/name |
| Target chain | Base / Base Sepolia (same as External) |

### 5.2 Env

```bash
NEXT_PUBLIC_CDP_PROJECT_ID=
NEXT_PUBLIC_CDP_AUTH=1          # mount CDPHooksProvider
NEXT_PUBLIC_WALLET_INGAME=1     # show “Create in-game wallet” CTA
```

### 5.3 Security rules

1. Never log or persist CDP owner EOA as player id.  
2. `useCdpParentSigner` / game signer **refuses** non-parent `account`.  
3. Paid CHIPS: join/claim `msg.sender` = CDP smart account (same as `wallet_address`).  
4. Builder Code `dataSuffix` on every `sendUserOperation` (CHIPS §8.7).  
5. Spend permissions / paymaster **not** in W1 (gated like CHIPS plan).

### 5.4 Passkey MFA (after first login) — **required product**

Passkey is **not** a primary CDP sign-in. Flow:

```text
Sign in (email OTP / Google / Apple / X)
        ↓
“Add passkey for extra security”   ← our Settings / post-signup sheet
        ↓
CDP MFA: WebAuthn (Face ID / Touch ID / security key)
        ↓
Protected ops re-prompt passkey when MFA is on
```

| Item | Spec |
| --- | --- |
| **When** | After successful CDP login (post-signup nudge + Settings → Security) |
| **Hooks** | `useEnrollPasskey` / `useVerifyPasskey` / `useListPasskeys` / `useDeletePasskey` |
| **Portal** | Enable **Passkey** under MFA in CDP Portal (`wallets/non-custodial/authentication`); origin must be in CORS allowlist |
| **Optional but recommended** | Not required to play free; **recommended before CHIPS / export** |
| **MFA-protected ops** | `signEvmMessage` / `signEvmTypedData` / `signEvmTransaction` / `sendUserOperation` / `createEvmKeyExportIframe` when enrolled |
| **Session** | Default CDP **session** scope (per access token / device) |
| **Copy** | “Passkey unlocks sensitive actions — same Face ID / Touch ID as your phone” |
| **Not** | Seed import · passkey-only login · Base Account passkey (that is Mode A) |

Enroll UI: our Ludo sheet → `enrollPasskey()` (or `@coinbase/cdp-react` `EnrollMfaModal` if we adopt it). Show enrolled passkeys + **Remove** (`useDeletePasskey`).

### 5.5 Export key (escape hatch) — **required product**

| Item | Spec |
| --- | --- |
| **API** | `useExportEvmAccount` → `createEvmKeyExportIframe` / `exportEvmAccount({ evmAccount })` |
| **UI chrome** | **Coinbase secure iframe only** |
| **Entry** | Settings → Wallet → **Export private key** (danger zone) |
| **MFA** | If passkey/TOTP MFA enrolled, export is **MFA-protected** |
| **Result** | **Owner EOA** private key — MetaMask import shows **`0x6e11…`**, **not** smart `0x221A…` |
| **Not** | Seed import · MM parity for smart address |

**Portability (2026-09-25):** do **not** require MetaMask to “show” `0x221A…`. Third-party dapps use **Ludo as WalletConnect wallet** (§5.7 / W5). Export remains a raw-key escape hatch only.

### 5.6 What stays Coinbase

OTP delivery, TEE keys, **key-export iframe**, MFA ceremony, device limits (~5), recovery.

### 5.7 Ludo as WalletConnect **wallet** (portability — locked)

```text
Third-party dapp (Uniswap, etc.)
        │  WalletConnect QR / wc: URI
        ▼
Ludo Base (we are the WALLET — WalletKit / web3wallet)
        │  approve session → sign / sendUserOperation
        ▼
CDP Smart Account 0x221A… (createOnLogin: "smart")
```

| Item | Spec |
| --- | --- |
| **Protocol** | Reown **WalletKit** / WalletConnect **web3wallet** (wallet role, not dapp) |
| **Chains (v1)** | Base / Base Sepolia only |
| **Sign path** | CDP: `signEvmMessage` / `signEvmTypedData` / `sendUserOperation` as **smart** `0x221A…` |
| **Desktop UX** | Show QR + copy `wc:` link; open `https://…/wc?uri=` |
| **Phone UX** | PWA / later RN: scan QR or open deep link |
| **Security** | Never auto-approve; show dapp origin, chain, method, value; rate-limit; user gesture for approve |
| **Batch** | Prefer EIP-5792 / UserOp batch when dapp supports |
| **Out of scope v1** | Solana WC · multi-chain · browser extension |

**What this replaces:** “export to MetaMask to use Uniswap.” Users keep `0x221A…` and **use it** on other dapps **through Ludo**.

| Portability | Path |
| --- | --- |
| Third-party dapps | **WalletConnect wallet (W5)** — primary |
| Raw key / cold exit | Export owner EOA (MM shows EOA only) |
| External-native users | Mode A (their own MM / Base / Phantom) |

---

## 6. External wallet (Mode A) — detailed

| Wallet | Connector | Notes |
| --- | --- | --- |
| Base Account | wagmi `baseAccount({ appName, appLogoUrl })` | `wallet_connect` + SIWE capability; popup branded |
| MetaMask | `metaMask()` / injected | Existing |
| Phantom | injected / `walletConnect` | EVM only for CHIPS; Solana out of scope |
| WalletConnect | `walletConnect` | Existing |

All txs: user’s wallet; keep **ERC-8021** `dataSuffix` on wagmi config.

---

## 7. CHIPS / economy rules (both modes)

| Rule | External | In-game |
| --- | --- | --- |
| `wallet_address` = seat | Connected wallet | CDP smart |
| `joinPool` `msg.sender` | Same | Same |
| Approve / batch | wagmi `useSendCalls` | CDP `sendUserOperation` |
| Gas | User or future 8168 | CDP paymaster later (Phase 3) — **not** W1 |
| Exact-fee join (CHIPS §4.6) | Unchanged | Unchanged — **no** weekly spend-perm as default |

Paid tables: **guest wallets** still blocked. In-game users can play free/offline without any chain tx.

---

## 8. Phase plan

### W0 — Decision & contracts (docs only) ✅ **DONE** 2026-09-25

- [x] Product direction locked (dual-path + one active wallet; no auto-merge) — 2026-09-25  
- [x] `SMART_WALLET_PLAN.md` points here (status superseded)  

### W1 — In-game wallet vertical slice (frontend)

- [x] Gate: **Create in-game wallet** CTA (`NEXT_PUBLIC_WALLET_INGAME=1`) — `InGameWalletPanel` in `LudoWalletModal`  
- [x] CDP email OTP + Google → `evmSmartAccountObjects[0]` via `resolvePlayerIdentity` (InGameWalletPanel)  
- [x] `usePlayerSigner()` switch External / In-game — `hooks/usePlayerSigner.ts` + `lib/walletMode.ts`  
- [x] Ludo SIWE + match EIP-712 via `usePlayerSigner` (CDP 6492 parent / wagmi)  
- [x] DM ECDH publish on first Send only (`usePlayerSigner.signMessageAsync`)  
- [x] No CHIPS value; no sub-accounts  
- [x] Copy: in-game ≠ Base app (InGameWalletPanel + export notes)  
- [x] **Passkey MFA:** Settings → Wallet (`WalletSecurityPanel`) — enroll / list / delete  
- [x] **Export key:** Settings → Wallet → `useExportEvmAccount` (owner EOA + confirm copy)

### W2 — External polish

- [x] `baseAccount` + MM/Phantom only in gate (Coinbase Wallet row hidden — Base CTA covers it; WC/safe not in gate)  
- [x] `wallet_connect` on click; nonce prefetch (done)  
- [x] Popup storm regression: DM / Quick Match / boot = no sign (`peekAppSession` on boot/inbox/presence)

### W3 — Optional link + switcher

- [x] Settings: link wallets (2-sig) + `wallet_links` — `WalletLinkPanel` + `app/api/wallet-links` + migration `202609250001_wallet_links.sql`
- [x] Profile switcher: In-game ↔ External (session-scoped `wallet_mode`)
- [x] Progression merge policy: **do not merge** at launch (API returns `progressionMerged: false`)

### W5 — Ludo = WalletConnect wallet (portability)

- [x] Reown WalletKit in Ludo (wallet role) — `lib/wcWallet.ts` + `@reown/walletkit`
- [x] Session approve UI (origin · chains · methods) — `WcWalletPanel` (Settings → Wallet)
- [x] Route `personal_sign` / `eth_signTypedData_v4` → `usePlayerSigner` (CDP smart / external)
- [x] Desktop: paste `wc:` URI + QR + `/wc?uri=` deep link
- [x] Base / Base Sepolia only; no auto-approve (explicit Sign / Reject)
- [x] `eth_sendTransaction` (external wagmi); `wallet_sendCalls` / UserOp = **W4** explicit reject
- [x] Phone camera scan QR — `QrScanButton` (html5-qrcode) + file picker

### W4 — CHIPS rails (CHIPS already implemented in-repo)

- [x] Mode-aware join/claim — `useChipsPool` (ingame → `useCdpUserOp`; external → wagmi batch/writeContract)
- [x] In-game `sendUserOperation` + `dataSuffix` — `hooks/useCdpUserOp.ts` (ERC-8021 + `useCdpPaymaster: true`)
- [x] `wallet_sendCalls` in W5 → CDP UserOp (in-game)
- [ ] Own ERC-8168 paymaster / 8130 session keys — still **CHIPS §8.9 Phase 3** (CDP paymaster interim)

---

## 9. Migration & compatibility

| Existing | Behavior |
| --- | --- |
| Current wagmi users | Mode External — no change |
| Phase 0a CDP spike address | Treated as **dev In-game** profile |
| SIWE 7-day sessions | Per `wallet_address` (unchanged) |
| Match sessions | Per address (unchanged) |
| `migrateGuestStash` | On **first** successful External **or** In-game bind |

---

## 10. Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| Users think In-game = Base app wallet | Explicit CTA copy + “wallet details” sheet |
| Two profiles (linked or not) | W3 link optional; launch without merge |
| CDP vendor lock (In-game) | External path remains full exit; keys exportable |
| Popup storm regression | Keep `peekAppSession`; CI note in W2 |
| CHIPS seat mismatch | §6: always parent/smart = `wallet_address` |
| Facebook | Not CDP — omit |

---

## 11. Success criteria (W1)

1. New user → **Create in-game wallet** → email OTP → play vs AI + free online with **zero** extension and **zero** keys.coinbase.com popup.  
2. Same user can pick **Continue with Base** and use Base Account popups.  
3. DM open / site load never opens a wallet.  
4. One address in UI per session; server verify green for both modes (1271/6492 + EOA).  
5. Typecheck 0; no `wallet_address` writes to owner EOA / sub.  
6. **Passkey MFA** enrollable after in-game login; protected ops prompt when enrolled.  
7. **Export key** opens Coinbase secure iframe from Settings (not our plaintext key UI).

---

## 12. Decision log

| Date | Decision |
| --- | --- |
| 2026-09-24 | Option A only (Base Account) — spike proved parent-sign + 6492 |
| 2026-09-24 | Email OTP ≠ Base app address; CDP embedded is a different wallet |
| **2026-09-25** | **Dual-path:** External (A + MM + Phantom) **and** In-game CDP wallet; one active `wallet_address` per session; optional link later |
| **2026-09-25** | In-game security: **passkey = MFA after** email/Google/Apple (not primary login); **export key** via Coinbase secure iframe; **no** seed/private-key import |
| **2026-09-25** | **Mode B locked = CDP Smart Account** (not EOA-only). MetaMask need not show `0x221A…` — third-party use = **Ludo as WalletConnect wallet (W5)**. Export = owner-key escape only |

---

*Invariants unchanged: SIWE never authorizes moves; Edge RNG; match/record signature-gated; builder-code on every tx; pull-only CHIPS claims. Engine/teams rules untouched.*
