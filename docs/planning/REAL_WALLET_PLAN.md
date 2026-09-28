# Real Wallet Plan — Ludo Wallet as a full Web3 wallet

| Field | Value |
| --- | --- |
| **Project** | Ludo Base |
| **Document type** | Product + implementation plan — wallet product (beyond CHIPS UI) |
| **Decision** | Evolve Ludo Wallet into a **first-class Web3 wallet**: assets, send/receive, activity, dapp connect, security (passkey/Touch ID), and standard wallet settings — not a CHIPS-only panel |
| **Companion** | `DUAL_PATH_WALLET_PLAN.md` (modes) · `CHIPS_PLANNING.md` · `SMART_WALLET_PLAN.md` |
| **Status** | Draft for product sign-off — implement in R0–R5 slices |
| **Last updated** | 2026-09-25 |

---

## 0. Product goal

Today the wallet surface is mostly **game economy** (CHIPS balance, claim, burn feed).  
A real wallet user expects the same job-to-be-done as MetaMask / Coinbase Wallet / Phantom:

> **See what I have → send/receive → know what happened → connect to apps → stay in control of security.**

Ludo Wallet should feel like a **wallet that also plays Ludo**, not a game HUD with a balance.

### Success criteria (product)

1. New user can **receive** ETH/USDC/CHIPS and **send** them without leaving Ludo.  
2. **Activity** lists transfers, joins, claims, and burns with explorer links.  
3. **Passkey / Touch ID** is the default security gesture after email/Google (already W1).  
4. **Connect to dapp** (WalletConnect) is one-tap from the wallet home.  
5. External and in-game modes both work on the same wallet IA (DUAL_PATH).  
6. No wallet-only dead ends: every balance has **Send / Receive / Details**.

---

## 1. What “real wallet” means (feature matrix)

| Area | Capability | Ludo today | Target |
| --- | --- | --- | --- |
| **Home** | Total value + token list | CHIPS bar only | ETH · USDC · CHIPS (**CHIPS unpriced badge**, excluded from USD total until a real market) |
| **Receive** | Address + QR + copy + ENS-less label | Partial (address chip) | Full receive sheet |
| **Send** | To address, amount, token, gas preview, confirm | ❌ / CHIPS only | Native + ERC-20 send |
| **Swap** | Token ↔ token | ❌ | Optional R4 (0x/Uniswap API) |
| **Activity** | Filterable txs + status + explorer | Burn feed / claims | Unified activity |
| **Connections** | WalletConnect sessions | W5 panel | Wallet home + sessions |
| **Sign / approve** | Typed data, messages, permit prompts | Scattered | Unified **Request inbox** |
| **Auth** | Email/Google + Base / MM / Phantom | ✅ dual-path | Same + clearer “who am I” |
| **Passkey / Touch ID** | MFA after login | W1 Settings | Nudge + step-up on send/export |
| **Export / recover** | Key export, recovery story | Export owner EOA | Same + wallet-details sheet |
| **Settings** | Currency, networks, privacy, security | Fragmented | Wallet tab |
| **Multi-chain** | Base first | Base 8453/84532 | Base first; others later |

---

## 2. Information architecture

```text
Wallet (primary tab / panel)
├── Home
│     ├── Mode chip: In-game · External
│     ├── Total value (USD — priced tokens only; CHIPS badge “unpriced”)
│     ├── Token list: ETH · USDC · CHIPS
│     └── Actions: Send · Receive · Buy (later) · Connect dapp
├── Activity
│     ├── All | Sends | Receives | Game | Apps
│     └── Tx detail (hash, gas, explorer)
├── Apps (WalletConnect)
│     ├── Paste / Scan wc:
│     └── Active sessions
├── Security
│     ├── Passkey / Touch ID
│     ├── Export key
│     └── Link wallets / switch mode
└── Settings (wallet-scoped)
      ├── Currency display
      ├── Networks (Base / Sepolia)
      └── Address book (recent senders)
```

**CHIPS** stays a **token + game modules** (claim, burn, marketplace) — not the wallet shell.

---

## 3. Core flows

### 3.1 Receive

- Show **active** `wallet_address` (parent/smart or external — never owner EOA as primary).  
- QR + copy + “This is a Base address (`0x…`)”.  
- Warn: “In-game smart address — not Base app address” (DUAL_PATH §5).  
- Token selector: ETH / USDC / CHIPS (contract addresses from `lib/chips.ts` + env).  
- Deep link: `ludo://pay?address=&token=` (optional).

### 3.2 Send (must-have)

| Step | Detail |
| --- | --- |
| 1 | Pick token + amount (**max branches by gas path**: self-pay EOA = balance − gas; paymaster-sponsored smart = full balance) |
| 2 | Paste / QR / address-book / “send to friend” (wallet link) |
| 3 | Preview: amount, token, to, **gas**, total |
| 4 | **Passkey step-up** if MFA enrolled (W1 hooks) |
| 5 | Sign via `usePlayerSigner` / CDP UserOp / wagmi |
| 6 | Success sheet + activity row |

**Rules:** exact display amount; no silent max+gas bugs; fail closed on wrong chain; Base-only v1.

### 3.3 Activity

- Sources: on-chain (viem `getTransactions` / explorer API) + **indexer** (CHIPS `chips_events` later).  
- Labels: Send · Receive · Join pool · Claim · Burn · App request.  
- Status: Pending · Confirmed · Failed.  
- Open BaseScan in new tab.

### 3.4 Sign-in / identity

Keep DUAL_PATH:

| Mode | Auth | Wallet id |
| --- | --- | --- |
| External | Base / MM / Phantom | Their address |
| In-game | Email/Google → CDP smart | `0x221A…` |

**Behavior polish:**  
- Returning user: “Continue as `0x…` / email” (last mode).  
- Never mix two ids in one session.  
- Copy: in-game ≠ Base app.

### 3.5 Passkey / Touch ID

| When | Behavior |
| --- | --- |
| After first in-game login | Nudge **Add passkey** (W1) |
| Send / export / large approve | **Step-up** via CDP MFA (`useInitiateMfaVerification`) |
| Unlock app (optional) | Device biometrics gate before wallet tab (local, not chain) |
| External MM/Phantom | Their own Face ID / extension — we do not replace |

---

## 4. Technical architecture

```text
UI: WalletShell (home · activity · apps · security · settings)
        │
        ├── usePlayerSigner          (mode: external | ingame)
        ├── useWalletAssets          (balances ETH/USDC/CHIPS)
        ├── useSendToken             (native + ERC-20)
        ├── useActivity              (explorer + optional indexer)
        ├── useCdpUserOp             (in-game sendCalls / UserOp)
        └── useWcWallet              (WalletConnect wallet role)
```

| Layer | Choice |
| --- | --- |
| **Balances** | `viem` `getBalance` + `readContract` ERC-20; cache 30s |
| **Send external** | wagmi `sendTransaction` / `writeContract` |
| **Send in-game** | CDP `sendUserOperation` + `dataSuffix` + paymaster (W4) |
| **Activity v1** | BaseScan API or `eth_getLogs` for CHIPS + native list; no new indexer required |
| **Passkey** | Existing CDP MFA hooks |
| **WC** | Existing W5 WalletKit |

### Identity (unchanged)

`wallet_address` = active mode’s parent/smart (or external EOA / Base Account). Never owner EOA / sub as id.

---

## 5. UX / visual

| Surface | Note |
| --- | --- |
| **Ludo theme** | Terminal-glass wallet cards; cyan CTAs; same tokens as lobby |
| **Wallet home** | Above-the-fold: balance + Send/Receive; game modules below |
| **Empty state** | “Your wallet is ready — receive funds” (not a blank CHIPS bar) |
| **Danger zone** | Export / disconnect separated |

---

## 6. Phases (R-slices)

### R0 — IA + Receive + Send ETH (smallest real wallet)

**Must:** max-send gas-path branch (M); CHIPS not in totals (H2) if tokens shown early; identity `needsReconnect` state (M).

- [ ] `WalletShell` route or panel (Home / Activity / Apps / Security)  
- [ ] Receive sheet (QR + copy + mode warning)  
- [ ] Send **native ETH** (Base) with gas preview + confirm  
- [ ] Wire `usePlayerSigner` (both modes)  
- [ ] Activity stub: “Sent / Received” from local confirm + explorer link  

### R1 — Tokens + Activity

- [x] Token list: ETH · USDC · CHIPS (unpriced badge) — `useWalletAssets`
- [x] Send ERC-20 (USDC/CHIPS) — `useSendToken` + `SendTokenSheet` (CDP UserOp / wagmi)
- [x] Activity: unified list + BaseScan — `useWalletActivity` + `WalletActivityList`
- [x] Linked wallets panel (W3) in Activity tab; full address book = localStorage later

### R2 — Security polish

- [ ] Passkey step-up on Send / Export  
- [ ] Wallet-details sheet (smart vs owner EOA copy)  
- [ ] Session restore / switcher (from W3) surfaced in Wallet home  

### R3 — Apps / WalletConnect home **(blocked on H1)**

- [ ] Move W5 panel into Wallet → Apps  
- [ ] Request **inbox** with **decoded summaries + unlimited-approve warning + value-at-risk** (H1)  
- [ ] Session expiry · chain scope · **Disconnect all**  
- [ ] `wallet_sendCalls` / UserOp from apps (W4) + UserOp status mapping (M)  
- [ ] **Do not ship** R3 without H1 consent UI

### R4 — Nice-to-have wallet

- [ ] Swap (0x / Uniswap quote)  
- [ ] Buy (onramp deep link)  
- [ ] NFT tab (optional)  
- [ ] Multi-chain (Ethereum / OP)  

### R5 — Mobile PWA

- [ ] Camera QR (partially done)  
- [ ] Push for tx / session  
- [ ] Biometrics gate before wallet  

---

## 7. Gaps vs current code

| Have | Missing for “real wallet” |
| --- | --- |
| `ChipsWalletPanel` / `ChipsBalanceBar` | Multi-token home, USD estimate |
| `useChipsPool` join/claim | **Generic send/receive** |
| `WalletSecurityPanel` | Step-up MFA on send |
| `WcWalletPanel` | Apps tab + request inbox |
| `WalletLinkPanel` | Address book |
| Activity: burn feed | **Unified on-chain activity** |

---

## 7b. Security hard requirements (review 2026-09-25)

### H1 — Request inbox must not enable blind value movement (block R3 until these exist)

| Requirement | Spec |
| --- | --- |
| **Decoded call summary** | `to`, `value`, function name, token amount for known ABIs (`transfer`, `approve`, `joinPool`, …) |
| **Unlimited approve** | If `approve` amount ≥ threshold / maxUint → **red banner** + “edit allowance” (we cannot edit dapp calldata; link to “reject and set exact allowance on dapp” copy) |
| **Value-at-risk** | Sum of native `value` + decoded token transfers in batch |
| **Simulation** | `eth_call` / tenderly-style sim when RPC allows; on failure show “could not simulate — treat as high risk” |
| **Session method scope** | `buildApproveSession` allowlist only; **denylist**: `eth_sign`, `eth_signTransaction`, `wallet_addEthereumChain`, `wallet_switchEthereumChain`, arbitrary `wallet_*` |
| **Phishing** | Show **peer origin domain** prominently (metadata is self-asserted); warn on lookalikes |

Related code: `lib/wcWallet.ts` (`buildApproveSession`, `isAllowedChain`, `parsePersonalSignParams`, `isUnlimitedOrHighRiskCalldata`) + `WcWalletPanel` risk banner.

### H2 — Total value must not price CHIPS
Unpriced assets → balance + badge only. See open question #1.

### M — Lifecycle & identity
| Item | Spec |
| --- | --- |
| **UserOp status** | `submitted → bundled → confirmed / failed` (map CDP statuses); never show UserOp hash as a BaseScan tx hash without “user operation” label |
| **Paymaster reject** | If CDP paymaster refuses, **fall back to self-pay** or surface explicit “gas sponsorship unavailable”; never opaque fail |
| **Identity switch** | In-game session lapse → **“session expired — reconnect”** UI (`needsReconnect`); **never** quiet swap to external address |
| **Chain gate** | `isAllowedChain` **fails closed** on missing `chainId` |
| **personal_sign params** | Support `[message, address]` and `[address, message]` |
| **Max send** | Branch by gas path (see Send step 1) |
| **CHIPS multi-chain** | CHIPS contract is **Base-only**; token lists **structurally omit** CHIPS on other chains |
| **R3 sessions** | Session expiry display, per-session chain scope, **Disconnect all** |

### L — Notes
- **Onramp (R4):** CDP domain allowlist when scoped.  
- **Deep link** `ludo://pay?`: strict address/token validation.  
- **WC peer metadata:** self-asserted — inbox must lead with origin + warning.

## 8. Risks

| Risk | Mitigation |
| --- | --- |
| Users treat in-game smart as MetaMask | Wallet-details + receive warning |
| Send UX bugs (gas / max) | Preview + tests + fail-closed chain gate |
| Explorer API rate limits | Cache; fallback client `getLogs` |
| Scope creep to full exchange | R4 swap optional; no CEX features |
| Blind WC approve / unlimited approve | H1 inbox decode + denylist + risk banner |
| CHIPS mispriced in totals | H2 unpriced badge |
| WC peer phishing (self-asserted metadata) | Show origin domain + lookalike warning |
| Security | Passkey step-up; no key in plaintext UI |

---

## 9. Open product questions

1. **USD pricing** source — default CoinGecko cache for ETH/USDC. **CHIPS is unpriced until a real market exists:** show balance-only + “unpriced / utility” badge; **never** invent a price or include CHIPS in total value (legal + honesty).  
2. **Buy crypto** — deep link Coinbase Onramp vs none in R0.  
3. **ENS / Basenames** — R4+.  
4. **NFTs** — out of R0–R2 unless needed for marketplace.

---

## 10. Decision log

| Date | Decision |
| --- | --- |
| 2026-09-25 | Dual-path wallet modes (W0–W5) complete for auth / CHIPS / WC |
| **2026-09-25** | **Real wallet plan** — ship Wallet home + Send/Receive + Activity first (R0–R1); keep CHIPS as modules |

---

*Invariants: SIWE never authorizes moves; Edge RNG; builder-code on every tx; pull-only CHIPS; one `wallet_address` per session.*
