# Signing-trigger graph — signing-storm reproduction (static, script-assisted)

> Owner: dynamic-repro track (this file only; static-diagnosis reviewer owns other paths).
> Generated with `node scripts/signing-triggers-scan.mjs` (101 hits across 163 files:
> 11× `signMessageAsync(`, 2× `signTypedDataAsync(`, 57× `ensureAppSession(`, 1× `ensureEcdhPublished(`, 3× `publishMyEcdhPubkey(`, 27× `setInterval(`).
> Raw scan output: re-run the scanner. This file is the curated audit the mission requires:
> every `signMessageAsync` site reachable from UI + every SIWE/ECDH caller with cadence + failure behavior.
> Line numbers pinned to tree at 2026-09-17 (scan re-verifiable via the script).

## 0. Funnel — one SIWE signer, ~57 callers, no cross-instance guard

`hooks/useAppSession.ts:47-84` is the ONLY SIWE `signMessageAsync` site:

```ts
// hooks/useAppSession.ts:47-84 (summarised)
if (!address) return null;
if (sessionId) return sessionId;          // per-instance state only
if (signingRef.current) return null;      // per-instance ref only
signingRef.current = true;
try {
  const message = buildSiweMessage({ domain, address, issuedAt, expirationTime, nonce });
  const signature = await signMessageAsync({ account: address, message }); // :58 — THE prompt
  const res = await fetch('/api/siwe/verify', { … signature, message … });
  const data = await res.json();
  if (!res.ok || !data.sessionId) { console.error('SIWE verify failed', data); return null; }
  localStorage.setItem('ludo-siwe-session', JSON.stringify({ sessionId, wallet, expiresAt }));
  setSessionId(data.sessionId); return data.sessionId;
} catch { return null; }                  // user-reject AND network both → null
finally { signingRef.current = false; }   // immediate re-prompt allowed
```

Failure semantics (both paths identical to callers):

- **user-reject** (wallet throws): `catch → return null`, no storage write, `signingRef` reset.
- **verify-failure** (401 `Invalid signature` / `Signer mismatch` / 500): `console.error` + `return null`, no storage write, `signingRef` reset.
- **No backoff, no failure cache, no negative-TTL.** The next `ensureAppSession()` call reprompts immediately.
- **No singleton:** `sessionId` + `signingRef` are per-`useAppSession()` instance. 10+ mounted
  instances (PresenceManager, usePeerChat, useDataActions, useMessages, useNotifications,
  TeamUpContext, useMatchmaking, useBettingController, …) each start with `sessionId=null`.
  The mount `useEffect` (`useAppSession.ts:22-44`) hydrates from `localStorage` only on
  `address` change — an instance mounted after another instance signed does NOT auto-pickup
  until remount. Consequence: **N concurrent instances → up to N prompts for one user intent**,
  and any verify-failure (e.g. 6492 smart wallet, see `scripts/siwe-matrix.ts`) leaves ALL
  instances sessionless so EVERY poll interval reprompts.

This is the loop engine. Everything below is a caller of this funnel (SIWE) or a direct signer (ECDH / match / stream).

## 1. Direct `signMessageAsync` / `signTypedDataAsync` sites (the only wallet popups)

| trigger | file:line | cadence | failure behavior (reject vs verify-fail) | loops? |
|---|---|---|---|---|
| SIWE app session (chat/profile/settings; NEVER match moves) | `hooks/useAppSession.ts:58` | on-demand via `ensureAppSession()` (see section 2 for all callers incl. 4s/15s/20s/30s polls) | reject → `null` silent; verify-fail → `console.error` + `null`; both reset guard, next caller reprompts | **YES — primary storm source** when verify can never succeed (6492) or session never persists |
| ECDH pubkey publish (static P-256 key → `POST /api/profile/ecdh`) | `hooks/useDataActions.ts:29` inside `publishMyEcdhPubkey()` | user-action: `sendMessage` (`useDataActions.ts:134`) every DM send; surface-enter: `ensureEcdhPublished` (`useDataActions.ts:265`) on messaging-surface mount (`MessagesPanel.tsx:251`) | `try/catch → console.warn('Failed to publish ECDH pubkey')`, silent; send continues to session-gated fetch (fails closed if no peer key) | YES if DM send retried: each `sendMessage` re-signs ECDH BEFORE checking session (line 134 precedes line 135) |
| EIP-712 match session grant (one sign per match → moves/powers without popups) | `hooks/useMoveAuth.ts:77` (`createProvisionalSession`) + `hooks/useMoveAuth.ts:143` (`createMatchSession`) | user-action: first match action / host seed path (`TeamUpContext.tsx:310-323`) | reject → `{ ok:false, error:'session sign rejected' }`; verify-fail → `{ ok:false, error:'HTTP …' }`; lazy `submitMove/pass/power` fall back to per-action `signMessageAsync` below | single retry per action; 401 renews via `createMatchSession` → **second prompt** per 401 |
| Seed match (host authority) | `hooks/useMoveAuth.ts:198` | user-action: host starts networked match | reject throws to caller (`TeamUpContext` logs `seed error`); no retry | no loop (single attempt) |
| Per-action fallback: move | `hooks/useMoveAuth.ts:251` | user-action: token move when `sessionRef` empty (guest first action / session cleared) | reject → `{ ok:false, error:'sign rejected' }`; 401 with session → clear + `createMatchSession` + ONE retry (lines 270-280) | at most 2 prompts per move (fallback + renewal) |
| Per-action fallback: pass | `hooks/useMoveAuth.ts:327` | user-action: pass turn when sessionless | same as move (lines 344-355 renew once) | at most 2 prompts |
| Per-action fallback: power | `hooks/useMoveAuth.ts:415` | user-action: power tile when sessionless | same (lines 433-443 renew once) | at most 2 prompts |
| Host-signed bet settlement (`resolve-bet` edge) | `hooks/useSignedResolveBet.ts:31` | user-action: host closes betting window / settles | `try/catch → console.error`, silent; edge verifies `host_address` | no loop (single attempt per resolve) |
| Match record (`POST /api/match/record`) | `hooks/useGameEngine.ts:187` via `recordMatchResult(…, msg => signMessageAsync(…))` | user-action: win (once per match, `hasRecordedWin` guard; attesting human signs even if bot won) | `catch → console.error('Match record signing failed')` | no loop (guarded once) |
| Stream toggle (host live) | `app/page.tsx:121` (`StreamToggle`) | user-action: host clicks Go live / Stop | `catch → setErr('Network error' / timeout)` UI only | no loop |
| Stream cleanup on leave | `app/page.tsx:481` (`handleBackToSubMenu`) | user-action: host leaves game while streaming | `catch {}` best-effort, local leave continues | no loop |
| Match-session plumbing (no popup itself) | `hooks/TeamUpContext.tsx:395` (`signMessageAsync: args => signMessageAsync(args)`) | pass-through into `useMoveAuth` + `useSignedResolveBet` | inherits callee behavior | — |

`signTypedDataAsync` appears ONLY at the two EIP-712 session sites above. No other typed-data prompts exist.

## 2. SIWE `ensureAppSession()` callers — each is a potential prompt when sessionless

> Pattern to recognise: `const sessionId = await ensureAppSession(); if (!sessionId) return;`
> When the wallet rejects OR `/api/siwe/verify` 401s (6492 smart wallets ALWAYS 401 — see matrix),
> this returns `null` and the caller silently skips its fetch. The NEXT caller / NEXT tick prompts again.

### 2a. Timer-driven (storm multipliers — prompt without fresh user intent)

| trigger | file:line | cadence | failure behavior | loops? |
|---|---|---|---|---|
| Invite poll | `app/components/InviteNotification.tsx:123` inside `poll()`, interval `setInterval(poll, 4000)` (`:137`) + realtime INSERT fallback | **every 4s** from mount while wallet connected | `if (!sessionId) return` — silent skip, next tick reprompts | **YES — hottest loop (4s)** |
| Host join-request poll | `hooks/TeamUpContext.tsx:825` inside `poll()`, interval `setInterval(poll, 2000)` (`:864`) | **every 2s** while `isHost && forming` | same silent skip | **YES — hottest loop (2s, host-only)** |
| Presence heartbeat | `app/components/PresenceManager.tsx:26` (`syncStatus`), interval `setInterval(syncStatus, 30000)` (`:57`); effect re-runs on `gameState.status/isStarted/roomCode` change (`:64`) re-firing immediate `syncStatus()` | 30s + every game-status transition + mount + unmount (`:62` fires `syncStatus('Offline')`) | silent skip; `beforeunload` variant (`:41`) fire-and-forget | YES — 30s baseline + transition bursts |
| Peer open/close presence | `hooks/usePeerChat.ts:95` (on `open`), `:137` (on destroy) | P2P connect/disconnect (can flap: `disconnected → reconnect`, `unavailable-id → 2s retry`, network errors → 5s retry, `:108-124`) | silent skip (`… ? fetch : null`) | YES when P2P flaps — each reconnect prompts |
| Messages refresh | `hooks/useMessages.ts:52` (`fetchInitialData`), interval `setInterval(fetchInitialData, 15000)` (`:70`) | 15s + mount | silent skip (no fetch when null) | YES — 15s |
| Notifications refresh | `hooks/useNotifications.ts:94` (`fetchAll`), interval `setInterval(fetchAll, 20000)` (`:145`) + realtime poke trigger | 20s + mount + every incoming poke | silent skip | YES — 20s |
| Matchmaking heartbeat | `hooks/useMatchmaking.ts:304` (`joinSupabase`), `:520` (`startHybridSearch`), `:189` (`cancelSearch`), `:87` (`resolveIsHost` catch→null), `:226` (`checkTicketStatus`); heartbeat `setInterval(heartbeatTick, 5000)` (`:475`), hybrid `setInterval(startHybridSearch, 5000)` (`:554`), 1s countdown timer (`:260`) | 5s during `searching/expanding` + every ticket check | `joinSupabase` THROWS when null (`'Wallet session required'` → `startSearch` error state); `checkTicketStatus` silently throws→`console.error`; `resolveIsHost` degrades to fallback + `onDegraded` | YES — 5s while searching; throw path surfaces error UI but does not stop timer |
| Matchmaking realtime handler | `hooks/useMatchmaking.ts:591` (`void checkTicketStatus(ticketId)` on queue UPDATE) | on realtime match event | same as above | single extra prompt per event |
| Betting window open/close mirror | `hooks/useBettingController.ts:37` + `:52` | per betting window (host, 3s window) | `if (sessionId && address)` guard — silent skip | only during live betting |

### 2b. Mount / boot (one prompt each per sessionless mount; N instances → N prompts)

| trigger | file:line | cadence | failure behavior | loops? |
|---|---|---|---|---|
| GameData boot | `hooks/useDataBoot.ts:31` (`bootSequence`) | once per `address` boot (plus manual re-boot) | `sessionId ? fetch : empty` — boot CONTINUES sessionless (profile/leaderboard load, DMs empty) | no loop alone, but leaves app sessionless so section 2a loops bite |
| Profile persistence | `hooks/useDataActions.ts:96` (`updateMyProfileOptimistic` → `void ensureAppSession().then(…)`) | on every profile/peer-id update | silent skip when null | no loop (fire-and-forget) |
| TeamUp presence/activity mirrors | `hooks/TeamUpContext.tsx:333` (presence), `:339` (activity), `:951` (presence on lobby change), `:569` (live-match register) — all `void Promise.resolve(appSessionId \|\| ensureAppSession()).then(…)` | on lobby/match transitions | silent skip | burst on transitions, not steady loop |

### 2c. User-action (correct: exactly one prompt per intent when healthy)

DM send (`useDataActions.ts:135,175` — note ECDH pre-sign at `:134` fires FIRST), mark-read (`:229`), delete (`:244`), peer-key check (`:259`), matchmaking join/cancel, friendships/pokes/marketplace/arena/spectator/settings/profile panels (see scan: `FriendsPanel:233,249,392,405,420,449`, `PublicProfileModal:101,135,255,277,294,306,319,331,356`, `SpectatorHUD:103,205,257,299`, `ArenaPanel:95,134`, `MarketplacePanel:453,495`, `SettingsPanel:267`, `UserProfilePanel:158`). All follow the same null-skip contract: healthy = 1 prompt then cached 7-day session; broken (6492-verify-fail or storage failure) = EVERY action reprompts AND section 2a timers keep prompting between actions — the user-perceived "constant signing prompts".

## 3. Why reject vs verify-failure are indistinguishable to the user (and why that storms)

`ensureAppSession` maps BOTH to `null` with no reason code. Callers cannot tell "user said no"
(don't ask again for a while) from "server will never accept this wallet" (asking again is futile).
There is no `lastFailureAt`, no exponential backoff, no `verifyFailedPermanently` flag, no
`sessionUnsupported` cache. Combined with:

1. **Verify-can-never-succeed wallets** — `POST /api/siwe/verify` uses `recoverMessageAddress` only
   (`app/api/siwe/verify/route.ts:50-59`); EIP-6492 wrappers 401 with `Invalid signature`
   (proven live: matrix (c) → `401 {"error":"Invalid signature"}` vs (a) → `200 {success,sessionId}`).
   Coinbase Smart Wallet / other 4337 accounts on iPhone therefore NEVER obtain a session.
2. **Per-instance session state** (section 0) — even a successful sign only satisfies ONE hook instance;
   siblings still prompt until remount/localStorage re-read.
3. **4s + 2s + 15s + 20s + 30s + 5s pollers all calling the funnel** (section 2a) — a sessionless client
   is re-prompted on the fastest active cadence (2s as host, 4s as guest) even if the user
   never clicks anything. Each prompt is a wallet popup on iPhone (MetaMask + Coinbase Smart
   Wallet both affected per incident).

Poller retry storms and ERC-6492 rejection are COMPOUNDING, not competing, hypotheses:
6492 explains *why the session never sticks*; pollers explain *why the popup never stops*;
non-persistence (per-instance state + `localStorage` cleared/expired/mismatched-wallet at
`useAppSession.ts:31-38`) explains *why even EOAs can storm after expiry or wallet switch*.

## 4. ECDH second popup (separate from SIWE, same UX)

`sendMessage` signs ECDH (`:134`) THEN ensures SIWE (`:135`, `:175`): a sessionless DM send =
**two popups back-to-back** (ECDH + SIWE). `ensureEcdhPublished` (`:255-269`) correctly checks
`serverJwk === localJwk` and skips the sign when already published — but it ALSO calls
`ensureAppSession()` FIRST (`:259`), so a 6492 wallet pays the SIWE popup even for the no-op
check. ECDH `POST /api/profile/ecdh` uses the same `recoverMessageAddress`-only check
(`app/api/profile/ecdh/route.ts:38-42`) so smart wallets fail ECDH publish too (403/401),
leaving `sendMessage`'s 1.2s retry (`:139`) and fail-closed path as the only brake.

## 5. Re-verify commands

```bash
node scripts/signing-triggers-scan.mjs            # raw counts + file:line hits
node scripts/signing-triggers-scan.mjs --json     # machine-readable (pipe to jq)
npx tsx scripts/siwe-matrix.ts                    # offline: (a) PASS / (c) REJECTED / (b) SKIP
npx tsx scripts/siwe-matrix.ts --live             # live: (a) 200 / (c) 401 against local dev + scratch DB
```

A fix PR must demonstrate against this graph + the matrix (see `docs/notes/loop-repro.md` for the
acceptance harness): sessionless pollers stop prompting, one intent = at most one popup, and
6492 wallets get a terminal non-retrying state instead of an infinite 4s/2s popup loop.
