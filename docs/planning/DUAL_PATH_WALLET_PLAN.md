# Dual-Path Wallet Plan — External Wallet + In-Game CDP Wallet

| Field | Value |
| --- | --- |
| **Project** | Ludo Base |
| **Document type** | Product + implementation plan — wallet modes |
| **Decision** | **Two first-class modes:** (1) **External wallet** (Base Account / MetaMask / Phantom) for users who want their own wallet; (2) **In-game CDP wallet** (email/Google/Apple/X) — fully themed, Coinbase-custodied keys, no extension required |
| **Supersedes** | Identity-only-Base-Account lock in `SMART_WALLET_PLAN.md` §1.1 (Option A alone). Recovery of “Option C dual-id risk” is solved by **mode = one wallet per session** (see §3) |
| **Companion** | `SMART_WALLET_PLAN.md` · `PHASE_0A_SPIKE_CHECKLIST.md` · `CHIPS_PLANNING.md` §4.6 |
| **Status** | Draft — product OK to implement Phase W0–W1 |
| **Last updated** | 2026-09-25 |

---

## 0. Product decision (locked)

Users pick **how they play**, not “which chain address class”:

| Mode | Who it’s for | Identity (`wallet_address`) | Sign UX | Popups |
| --- | --- | --- | --- | --- |
| **A · External wallet** | Base app / MetaMask / Phantom users | Connected EOA or Base Smart Account | **Their** wallet (keys.coinbase.com, MM, Phantom) | Their popups + our `appName`/`appLogoUrl` on Base |
| **B · In-game wallet** | “Just let me play” / mobile web / no extension | **CDP embedded Smart Account** (project-scoped) | **Our** Ludo UI (usually no Coinbase popup) | Almost none; Coinbase only for OTP mail + key export iframe |

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

### 5.4 What stays Coinbase

OTP delivery, TEE keys, export iframe, device limits (~5), recovery.

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

### W0 — Decision & contracts (docs only) ✅ this document

- [ ] Product sign-off on §0 / §3 (one active wallet; no auto-merge)  
- [ ] Update `SMART_WALLET_PLAN.md` status pointer to this file  

### W1 — In-game wallet vertical slice (frontend)

- [ ] Gate: **Create in-game wallet** CTA (`NEXT_PUBLIC_WALLET_INGAME=1`)  
- [ ] CDP email OTP + Google → `evmSmartAccountObjects[0]` as `wallet_address`  
- [ ] `usePlayerSigner()` switch External / In-game  
- [ ] Ludo SIWE + one match EIP-712 **silent** (CDP)  
- [ ] DM ECDH publish on first Send only (existing flag)  
- [ ] No CHIPS value; no sub-accounts  
- [ ] Copy: in-game ≠ Base app  

### W2 — External polish (parallel)

- [ ] `baseAccount` + MM/Phantom only in gate (hide unused WC if desired)  
- [ ] `wallet_connect` on click; nonce prefetch (done)  
- [ ] Popup storm regression: DM / Quick Match / boot = no sign  

### W3 — Optional link + switcher

- [ ] Settings: link wallets (2-sig) + `wallet_links`  
- [ ] Profile switcher: In-game ↔ External (session-scoped `wallet_address`)  
- [ ] Progression merge policy (product)  

### W4 — CHIPS rails (after stable-build + CHIPS un-park)

- [ ] Mode-aware join/claim  
- [ ] In-game `sendUserOperation` + `dataSuffix`  
- [ ] Paymaster / 8168 per CHIPS §8.9  

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

---

## 12. Decision log

| Date | Decision |
| --- | --- |
| 2026-09-24 | Option A only (Base Account) — spike proved parent-sign + 6492 |
| 2026-09-24 | Email OTP ≠ Base app address; CDP embedded is a different wallet |
| **2026-09-25** | **Dual-path:** External (A + MM + Phantom) **and** In-game CDP wallet; one active `wallet_address` per session; optional link later |

---

*Invariants unchanged: SIWE never authorizes moves; Edge RNG; match/record signature-gated; builder-code on every tx; pull-only CHIPS claims. Engine/teams rules untouched.*
