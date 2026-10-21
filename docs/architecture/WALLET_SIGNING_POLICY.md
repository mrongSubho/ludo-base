# Wallet Signing & Authentication Policy

> **Authoritative Specification:** Single source of truth for all wallet signing triggers, prompt cadences, biometric gates, and authentication boundaries across Ludo Base.
> References: [AGENTS.md](../../AGENTS.md), [`ENGINE_LOGIC.md`](../../ENGINE_LOGIC.md), [`lib/appSessionGuard.ts`](../../lib/appSessionGuard.ts), and [`hooks/useSecurityPrefs.ts`](../../hooks/useSecurityPrefs.ts).

---

## 1. Core Architecture & Wallet Separation Boundary

Ludo Base strictly bifurcates wallet authentication based on signer type. The single runtime authority for this boundary is [`useWalletMode()`](../../hooks/usePlayerSigner.ts).

```
                      ┌───────────────────────────────┐
                      │      useWalletMode()          │
                      └──────────────┬────────────────┘
                                     │
                 ┌───────────────────┴───────────────────┐
                 ▼                                       ▼
        mode === "ingame"                       mode === "external"
        (CDP Embedded Wallet)                   (MetaMask, Base Account, WC)
  ┌─────────────────────────────┐        ┌───────────────────────────────────┐
  │ • App-level passkey BootLock│        │ • Native wallet authentication    │
  │ • Device bio step-up (MFA)  │        │ • NO Ludo passkey or bio gates    │
  │ • Configurable autoSign     │        │ • Native extension/app prompts    │
  │ • WebAuthn navigator.creds  │        │ • Standard wagmi/viem signers     │
  └─────────────────────────────┘        └───────────────────────────────────┘
```

### Invariant Rules
1. **CDP In-Game Wallet Only:** Passkey and device biometrics guard app boot and sensitive transactions *only* when the CDP wallet is active.
2. **External Wallets are Self-Governing:** MetaMask, Base Account, WalletConnect, and all external wagmi connectors are **never** intercepted by Ludo's passkey or biometric gates. Their native client handles biometric/PIN unlock and signature approval.
3. **No Cross-Wallet Controls:** Do not expose or trigger Ludo passkey, biometric boot-lock, or biometric transaction settings for external wallets. Security toggles must never execute WebAuthn/device-bio challenges when the active signer is external.

---

## 2. Surface Matrix & Trigger Catalog

| Surface | Trigger / Cadence | CDP In-Game Wallet (`mode === "ingame"`) | External Wallet (`mode === "external"`) | Failure / Rejection Policy | Code Reference |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **App Boot** | App launch / mount | Prompted via WebAuthn if `bootLock` is ON and passkey enrolled | Skipped completely (native wallet manages lock) | 5 failed attempts locks user out temporarily | [`app/components/BootLock.tsx`](../../app/components/BootLock.tsx) |
| **App Session (SIWE)** | Explicit user action needing off-chain state (Matchmaking, Chat, Profile, Settings) | If `autoSign: true`: Silent background sign.<br>If `autoSign: false`: Prompts device biometric before signing | Native wallet signature popup (`personal_sign`) | Guarded by [`appSessionGuard`](../../lib/appSessionGuard.ts) (60s cooldown on reject, 3-fail terminal stop) | [`hooks/useAppSession.ts`](../../hooks/useAppSession.ts) |
| **Matchmaking & Lobby** | Host game or join matchmaking queue (Quick Match / Team Up) | Pre-auth signing gate ([`SignWaitModal`](../../app/components/SignWaitModal.tsx)) awaits SIWE + provisional session before search radar starts | Pre-auth signing gate ([`SignWaitModal`](../../app/components/SignWaitModal.tsx)) awaits SIWE + provisional session before search radar starts | Rejection or failure cancels flow, toasts error, and returns player safely to lobby without starting search | [`app/components/GameLobby.tsx`](../../app/components/GameLobby.tsx) |
| **In-Game Moves & Dice** | Every turn, roll, and power activation | **ZERO Signatures.** Uses Session v2 bearer token over WebSocket to MatchRoom DO | **ZERO Signatures.** Uses Session v2 bearer token over WebSocket to MatchRoom DO | MatchRoom validates session token; invalid intents are dropped | [`src/room/MatchRoom.ts`](../../src/room/MatchRoom.ts) |
| **Match Outcome** | Game over (once per match) | Attesting human player signs canonical match summary payload | Attesting human player signs canonical match summary payload | Result rejected if signer is not a registered seat or winner mismatch | [`app/api/match/record/route.ts`](../../app/api/match/record/route.ts) |
| **Direct Messaging (DMs)** | 1st time messaging a user | Signs/publishes ECDH P-256 public key via SIWE session | Signs/publishes ECDH P-256 public key via SIWE session | **Fails closed** if peer has no key; no plaintext fallback | [`lib/encryption.ts`](../../lib/encryption.ts) |
| **Onchain Transactions** | Send, Swap, Export, Wager | If `txStepUp === "strict"`: Requires device bio unlock.<br>If `txStepUp === "confirm"`: Ludo Confirm button only | Native wallet confirmation popup (extension / app) | User rejection cancels transaction | [`hooks/useMfaStepUp.ts`](../../hooks/useMfaStepUp.ts) |
| **Bet Settlement** | Match completion pool distribution | Derived strictly from recorded `match_states.state.winner` on server | Derived strictly from recorded `match_states.state.winner` on server | Settlement denied if match winner has not been authoritatively finalized | [`hooks/useSettlePool.ts`](../../hooks/useSettlePool.ts) |

---

## 3. CDP Security Preferences & Signing Lifecycle (`useSecurityPrefs`)

CDP in-game wallet users can configure their signing security in **Settings → Security**. External wallets (MetaMask, Base Account, etc.) **ignore these settings completely** because external wallet extensions own all signature approvals natively.

### Security Preference Options

| Preference | LocalStorage Key | Type | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `bootLock` | `ludo-security-boot-lock` | `boolean` | `true` | Requires passkey / biometric authentication on every app launch. |
| `txStepUp` | `ludo-security-tx-step` | `"strict" \| "confirm"` | `"strict"` | `"strict"` requires device Face ID / Touch ID / PIN before executing on-chain transactions; `"confirm"` allows one-click confirmation using CDP session keys. |
| `autoSign` | `ludo-security-auto-sign` | `boolean` | `true` | Enables seamless gaming flow without manual redundant biometric gates. |

---

### CDP Passkey Architecture & Signing Flow

CDP in-game wallets are **smart accounts owned by a hardware WebAuthn passkey**. Because the private key is managed by the device's secure enclave / WebAuthn, signing messages cryptographically invokes the enrolled passkey.

```
                  ┌────────────────────────────────────────┐
                  │        CDP In-Game Wallet Action       │
                  └───────────────────┬────────────────────┘
                                      │
                 ┌────────────────────┴────────────────────┐
                 ▼                                         ▼
         Session Cached (7-Day TTL)                Initial Auth / Expired
   ┌───────────────────────────────┐        ┌───────────────────────────────────┐
   │ • 0ms Cache Hit               │        │ • SignWaitModal displays context  │
   │ • ZERO Biometric Prompts      │        │ • CDP SDK requests Passkey        │
   │ • Quick Match & Team Up open  │        │   (Face ID / Touch ID / PIN)      │
   │   immediately with no delays  │        │ • Session cached for 7 days       │
   └───────────────────────────────┘        └───────────────────────────────────┘
```

#### Surface Behavior Matrix

| Flow / Surface | First-Time / Expired Session | Active Cached Session (Within 7-Day TTL) |
| :--- | :--- | :--- |
| **App Launch** | Guarded by `BootLock` (Passkey/Face ID if enabled). | Guarded by `BootLock` (Passkey/Face ID if enabled). |
| **Lobby & Matchmaking**<br>(Quick Match / Team Up) | **One-time Passkey Sign-in.** `SignWaitModal` appears with `"Awaiting Signature"` while the OS prompts for Passkey verification. Radar opens once signed. | **ZERO Prompts.** Cached SIWE session is used. Radar or Team Up opens immediately in 0ms. |
| **Direct Messaging (DMs)** | One-time Passkey sign to publish ECDH key and authenticate. | **ZERO Prompts.** Messages send silently in the background. |
| **Missions & Rewards** | Authenticates via cached SIWE session. | **ZERO Prompts.** Claims and vouchers resolve seamlessly. |
| **In-Game Turns**<br>(Roll, Move, Powers) | **ZERO signatures.** WebSocket intents with Session v2 bearer token to MatchRoom DO. | **ZERO signatures.** Gameplay is never interrupted by biometric popups. |
| **On-Chain Transactions**<br>(Send, Swap, Wager) | Governed by `txStepUp`: Requires device bio unlock if `strict` (default), or 1-tap confirm if `confirm`. | Governed by `txStepUp`: Requires device bio unlock if `strict` (default), or 1-tap confirm if `confirm`. |

---

## 4. Signing Storm Prevention & Session Guard

In earlier iterations, poller timers (presence, notifications, lobby status) called `ensureAppSession()`, causing wallet signature popup loops (especially when smart accounts like EIP-6492 failed verification).

To permanently prevent signing storms, the following invariants are enforced:

### The `appSessionGuard` State Machine ([`lib/appSessionGuard.ts`](../../lib/appSessionGuard.ts))
1. **Singleton with Shared In-Flight:** All concurrent requests across components share one in-flight promise. 10 mounted hooks produce at most **one** signature request.
2. **7-Day Session TTL:** Verified sessions are stored in localStorage (`ludo-siwe-session`) and reused across the app until expiration.
3. **Rejection Cooldown (`DEFAULT_REJECT_COOLDOWN_MS = 60_000`):** If a user rejects a signature request, all subsequent automated requests return `null` immediately for 60 seconds without prompting the wallet.
4. **Exponential Backoff & Terminal Failure:**
   - Verify failures back off according to `[15_000, 60_000]` ms.
   - After **3 consecutive verification failures**, the address enters a **terminal failed state**. Automated callers return `null` without signing.
   - Terminal state is only reset by an explicit, user-initiated action (e.g. clicking "Try Again" or changing wallets).

### Developer & Agent Rules of Engagement
- **NEVER** call `ensureAppSession()` inside naked `setInterval()` or recurring poller callbacks.
- Pollers must check `peekAppSession()` or read cached session state. If no session is present, pollers must skip silently.
- Only trigger `ensureAppSession()` or signature prompts from **direct user gestures** (clicking Play, Join, Send, Claim, or Save).

---

## 5. End-to-End Encryption (DM) Signing Policies

Direct messages use ECDH P-256 sealed boxes ([`lib/encryption.ts`](../../lib/encryption.ts)):
1. **Non-Extractable Keys:** The ECDH private key is generated client-side and persisted as a non-extractable `CryptoKey` in IndexedDB.
2. **Public Key Publication:** The public key is published to `players.ecdh_pubkey` via `POST /api/profile/ecdh`, authenticated by the SIWE app session.
3. **No Plaintext Downgrade:** If the recipient does not have an ECDH public key on file, message dispatch fails closed. Plaintext messaging over the wire is strictly forbidden.
4. **Database Immutability:** The Postgres RLS trigger `messages_restrict_columns` blocks any update to `sender_address`, `recipient_address`, or `encrypted_content`.

---

## 6. Server Authority & Zero-Signature Networked Play

Networked multiplayer operates under server authority ([`src/room/MatchRoom.ts`](../../src/room/MatchRoom.ts)):
- **Turn Actions:** Rolling dice and moving tokens **do not require wallet signatures**.
- **Intent Transport:** Clients send JSON WebSocket intents (`REQUEST_ROLL`, `REQUEST_MOVE`) authenticated with a Session v2 bearer token.
- **Deduplication:** Dual-path transports (Supabase Broadcast + PeerJS) use `actionId` and `intentId` tracking to guarantee idempotent execution.
- **RNG & Clocks:** Dice generation and turn countdowns are strictly managed by the Durable Object on the server.

---

## 7. System-Wide Signature Loading Modal (`SignWaitModal`)

Whenever a wallet signature (SIWE app session or EIP-712 match session grant) is requested, the system displays a unified loading modal ([`SignWaitModal`](../../app/components/SignWaitModal.tsx)) until the signature is confirmed or cancelled.

### UI / UX Invariants
1. **Never Interrupt Active Radar/Countdown:** In Quick Match and Team-Up, the search radar, matching timers, and websocket queue subscriptions **must not start** while waiting for a signature. Both the SIWE app session and the provisional match grant must be established before engaging matchmaking.
2. **Deterministic Cancel / Abort:** The modal includes a **"Return to Lobby"** button. If clicked by the user, the signature flow is aborted, cleaning up modal state and safely returning the player to the lobby without initiating orphan search states or unintended joins.
3. **Dual Theme Loyalty:** The modal (`.ludo-authwait-scope`) renders native design tokens across both themes:
   - **Retro-Futurism (`theme-retro-futurism`)**: Deep cosmic glass, pulsing cyan beacon (`#00E5FF`), violet perimeter glow (`rgba(124, 58, 237, 0.35)`).
   - **Daybreak (`theme-daybreak`)**: Cream porcelain card, dark slate typography (`#171717`), deep teal accents (`#0d6d87`), amber pulse highlights.

### Architecture & Call Flow
```
Component Gesture (Play / DM / Claim / Bet)
         │
         ▼
  ensureAppSession({ context }) / createProvisionalSession(key, id, { context })
         │
         ├─── If Session Cached (sessionStorage / localStorage) ─────────────► Fast Path (0ms, No Modal)
         │
         └─── If Signature Required:
                   │
                   ▼
         showAuthPrompt({ context, onCancel })  <─── Singleton store in hooks/useAuthPrompt.ts
                   │
                   ▼
         <GlobalSignWaitModal /> (Mounted at root in app/Providers.tsx)
                   │
         ┌─────────┴─────────┐
         ▼                   ▼
   User Approves       User Cancels ("Return to Lobby" / Rejection)
         │                   │
         ▼                   ▼
   Execute Action      Abort flow, display toast, stay in lobby
```

### Contextual Copy Matrix

| Context | Title | Badge | Description |
| :--- | :--- | :--- | :--- |
| `quick-match` | **MATCHMAKING SIGN-IN** | Awaiting Signature | Please approve the sign-in request in your wallet to search for online opponents. |
| `teamup` | **TEAM UP SIGN-IN** | Awaiting Signature | Please approve the sign-in request in your wallet to host or join multiplayer parties. |
| `messaging` | **MESSAGING SIGN-IN** | Awaiting Signature | Please approve the sign-in request in your wallet to decrypt and send end-to-end encrypted messages. |
| `social` | **SOCIAL ACTION SIGN-IN** | Awaiting Signature | Please approve the sign-in request in your wallet to update friends or send pokes. |
| `marketplace` | **CUSTOMIZATION SIGN-IN** | Awaiting Signature | Please approve sign-in in your wallet to save your equipped board style and token skins. |
| `missions` | **CLAIM REWARD SIGN-IN** | Awaiting Signature | Please approve sign-in in your wallet to generate and verify your mission claim voucher. |
| `betting` | **SPECTATOR BETTING SIGN-IN** | Awaiting Signature | Please approve sign-in in your wallet to register your live match prediction. |
| `general` | **WALLET SIGN-IN REQUIRED** | Awaiting Signature | Please approve the sign-in request in your wallet to proceed. No gas fee required. |
