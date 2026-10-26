# Ludo World — Architecture, Protocol and Data Teardown

| Field | Value |
| --- | --- |
| **Subject** | Ludo World / *Ludo Superstar* — `com.tencent.ludosuperstar`, `versionName 2.1.10` |
| **Artifact** | `research/ludo-world/ludo-world.apk` — 77.8 MB, 5,622 entries, 132.6 MB uncompressed |
| **Extraction** | `research/ludo-world/extracted/` (145 MB) + `research/ludo-world/modules/` (420 recovered JS modules) |
| **Method** | Static only. No execution, no traffic capture, no dynamic instrumentation. |
| **Companions** | `docs/research/COMPETITIVE_LUDO_WORLD_LUDO_KING.md` (comparative baseline) · `research/ludo-world/ANALYSIS.md` (first-pass findings) |
| **Status** | Architecture / protocol / schema teardown + Ludo Base gap analysis |
| **Date** | 2026-10-25 |

---

## Table of Contents

- [0. How to read this, and what it can and cannot prove](#0-how-to-read-this-and-what-it-can-and-cannot-prove)
- [1. Artifact identity and build topology](#1-artifact-identity-and-build-topology)
  - [1.1 Where the code actually lives](#11-where-the-code-actually-lives)
- [2. Client architecture](#2-client-architecture)
  - [2.1 Layering [V]](#21-layering-v)
  - [2.2 Module census [V]](#22-module-census-v)
  - [2.3 The dual-mode split is the architecture](#23-the-dual-mode-split-is-the-architecture)
- [3. Server architecture](#3-server-architecture)
  - [3.1 Service topology [V]](#31-service-topology-v)
  - [3.2 Wire format — TDR + a fixed head [V]](#32-wire-format--tdr--a-fixed-head-v)
  - [3.3 Router booking — the DO analogue [V]](#33-router-booking--the-do-analogue-v)
  - [3.4 Protocol catalogue [V]](#34-protocol-catalogue-v)
  - [3.5 Auth and login [V]](#35-auth-and-login-v)
  - [3.6 The cast packet carries a client-chosen dice value [V] ⚠](#36-the-cast-packet-carries-a-client-chosen-dice-value-v-)
  - [3.7 Resilience ladder — the numbers the earlier reports lacked [V]](#37-resilience-ladder--the-numbers-the-earlier-reports-lacked-v)
  - [3.8 Virtual match = server-side bot backfill [I]](#38-virtual-match--server-side-bot-backfill-i)
  - [3.9 Region config [V]](#39-region-config-v)
- [4. Data and schema](#4-data-and-schema)
  - [4.1 Remote config registry — 19 numeric buckets [V]](#41-remote-config-registry--19-numeric-buckets-v)
  - [4.2 Runtime game state schema [V]](#42-runtime-game-state-schema-v)
  - [4.3 Persistence — deliberately thin [V]](#43-persistence--deliberately-thin-v)
  - [4.4 Error taxonomy [V]](#44-error-taxonomy-v)
  - [4.5 Config encoding: string matrices [V]](#45-config-encoding-string-matrices-v)
- [5. Game rules and board math](#5-game-rules-and-board-math)
  - [5.1 Constants [V]](#51-constants-v)
  - [5.2 Board geometry per mode [V]](#52-board-geometry-per-mode-v)
  - [5.3 Special points (safe squares) [V]](#53-special-points-safe-squares-v)
  - [5.4 Mechanics that differ from Ludo Base](#54-mechanics-that-differ-from-ludo-base)
- [6. Dice, fairness, and what the APK actually contains](#6-dice-fairness-and-what-the-apk-actually-contains)
  - [6.1 The mechanism [V]](#61-the-mechanism-v)
  - [6.2 The AI can aim at captures [V]](#62-the-ai-can-aim-at-captures-v)
  - [6.3 The tables are not in the APK — this is the key correction [V]](#63-the-tables-are-not-in-the-apk--this-is-the-key-correction-v)
  - [6.4 Why this matters for Ludo Base](#64-why-this-matters-for-ludo-base)
- [7. Economy and monetisation](#7-economy-and-monetisation)
  - [7.1 Currencies and goods [V]](#71-currencies-and-goods-v)
  - [7.2 Props — four, carry three [V]](#72-props--four-carry-three-v)
  - [7.3 Live-ops surfaces [V]](#73-live-ops-surfaces-v)
  - [7.4 Ads [V]](#74-ads-v)
- [8. User-side surfaces and flows](#8-user-side-surfaces-and-flows)
  - [8.1 Window census — 126 [V]](#81-window-census--126-v)
  - [8.2 The compliance suite is the most under-appreciated part [V]](#82-the-compliance-suite-is-the-most-under-appreciated-part-v)
  - [8.3 Turn lifecycle and AFK [V]](#83-turn-lifecycle-and-afk-v)
  - [8.4 Session lifecycle [V]](#84-session-lifecycle-v)
- [9. Ludo Base comparison, axis by axis](#9-ludo-base-comparison-axis-by-axis)
  - [9.1 The three things that actually matter](#91-the-three-things-that-actually-matter)
- [10. Recommended technology for Ludo Base](#10-recommended-technology-for-ludo-base)
  - [10.1 Copy the resilience ladder — highest leverage, lowest cost](#101-copy-the-resilience-ladder--highest-leverage-lowest-cost)
  - [10.2 Make the turn clock server-owned](#102-make-the-turn-clock-server-owned)
  - [10.3 Adopt a typed rejection surface](#103-adopt-a-typed-rejection-surface)
  - [10.4 Formalise the route/instance identity](#104-formalise-the-routeinstance-identity)
  - [10.5 Replace hardcoded tiers with a versioned config registry](#105-replace-hardcoded-tiers-with-a-versioned-config-registry)
  - [10.6 Build the compliance surface before the paid pools](#106-build-the-compliance-surface-before-the-paid-pools)
  - [10.7 What not to take](#107-what-not-to-take)
  - [10.8 If you want one number to chase](#108-if-you-want-one-number-to-chase)
  - [10.9 Board kinematics & animation timing overhaul](#109-board-kinematics--animation-timing-overhaul)
  - [10.10 Multi-token stacking cluster geometry (`overlayPos`)](#1010-multi-token-stacking-cluster-geometry-overlaypos)
  - [10.11 Upgrading bot decision heuristics (`lib/aiEngine.ts`)](#1011-upgrading-bot-decision-heuristics-libaienginets)
  - [10.12 Interactive emotes & seat-to-seat projectiles (`GiftAnimManager`)](#1012-interactive-emotes--seat-to-seat-projectiles-giftanimmanager)
  - [10.13 Prioritized implementation roadmap](#1013-prioritized-implementation-roadmap)
  - [10.14 State synchronization: Event-deltas vs. monolithic snapshots](#1014-state-synchronization-event-deltas-vs-monolithic-snapshots)
  - [10.15 The client animation barrier pattern (`setGlobalCacheMessage`)](#1015-the-client-animation-barrier-pattern-setglobalcachemessage)
  - [10.16 Operational telemetry & connection state machine](#1016-operational-telemetry--connection-state-machine)
- [11. Corrections to prior documents](#11-corrections-to-prior-documents)
- [12. Limits of this analysis](#12-limits-of-this-analysis)
- [13. Architectural Decision Records (ADRs for Ludo Base)](#13-architectural-decision-records-adrs-for-ludo-base)
  - [ADR-01: Server-authoritative match lifecycle via DO alarms](#adr-01-server-authoritative-match-lifecycle-via-do-alarms)
  - [ADR-02: Strict mode partitioning (Ranked DO vs. Offline Local)](#adr-02-strict-mode-partitioning-ranked-do-vs-offline-local)
  - [ADR-03: Typed wire contract & rejection surface (`RoomError`)](#adr-03-typed-wire-contract--rejection-surface-roomerror)
  - [ADR-04: Signed dynamic config registry (Edge KV)](#adr-04-signed-dynamic-config-registry-edge-kv)

---

## 0. How to read this, and what it can and cannot prove

Every claim below is tagged:

- **[V]** — verified directly in the artifact (file, constant, message ID, or structure).
- **[I]** — inferred from verified structure. Reasonable, not proven.
- **[X]** — cannot be determined statically. Explicitly out of reach.

This matters because two prior documents drifted into [X] territory. The honest summary:

- **[X] The actual dice distribution.** The probability tables are *not in the APK*. The client only
  knows their **schema** (a semicolon-delimited string matrix) and the **remote config bucket id**
  (`1007`). See §6.
- **[X] Server-side matchmaking/ELO.** No ELO, MMR, or rank-matching logic exists client-side; only
  room-type integers and rank *display* surfaces.
- **[X] Whether the server honours the client's GM dice field.** The wire field exists and the client
  ships UI to set it (§3.6); the server-side gate is invisible from here.
- **[X] Post-2.1.10 behaviour.** This is a single build.

---

## 1. Artifact identity and build topology

| Property | Value | Evidence |
| --- | --- | --- |
| Package | `com.tencent.ludosuperstar` | manifest string pool; `google-services.json.package_name` **[V]** |
| versionName | `2.1.10` | manifest string pool **[V]** |
| Game-logic version | `2.2.8` | `ConstDefine.GAME_VERSION` **[V]** — *not* the app version |
| Engine | Cocos Creator 2.x (JSB) | `libcocos2djs.so`, `assets/main.js` `window.boot()`, `jsb-adapter/` **[V]** |
| Native libs | `libcocos2djs.so`, `libCrashSight.so` only | `lib/{arm64-v8a,armeabi-v7a}/` **[V]** |
| Dex | `classes.dex` 8.5 MB, `classes3.dex` 6.5 MB, `classes2.dex` 2.1 KB, `assets/audience_network/classes2.dex` | **[V]** |
| Billing | Play Billing **7.0.0** | `billing.properties` **[V]** |
| Firebase | Analytics **21.2.2**, project `ludo-superstar-41f63` | `firebase-analytics.properties`, `google-services.json` **[V]** |
| `res/` | **name-obfuscated** (`-8.xml`, `-B.png`), **no `values-*` dirs** | **[V]** |

> **Correction to both prior reports.** `res/values-*` locale trees do not exist in this APK — `res/`
> is flattened and obfuscated. Localisation is Cocos-side (`LanguageData` + `LocalizedLabel` /
> `LocalizedSprite`), and the language packs are not in this extraction. The "~106 locales" figure
> from the competitive doc is **not verifiable here** and should not be cited until re-checked against
> a source that actually contains them.

### 1.1 Where the code actually lives

This is the single most important structural fact, and it is easy to get wrong:

```
assets/assets/main/index.js      2.77 MB   ← the real bundle (minified, cc._RF modules)
assets/src/assets/Script/TSDK/tsdk.js  1.3 MB / 23,769 lines  ← network SDK
modules/*.js                     420 files, 3.3 MB  ← extracted slice of the bundle
```

`modules/` is **not** the whole client. The config layer, the state machines
(`StatePlayDice`, `StateSelMove`), and `LanguageData` live only in the minified bundle. Anything
claimed from `modules/` alone is a partial view — that is why §6's tables are missing.

---

## 2. Client architecture

### 2.1 Layering [V]

```
┌──────────────────────────────────────────────────────────────┐
│ Panels (96) · Inlets (11) · Items (30)      ← view layer      │
│   96 *Panel.js, 11 *Inlet.js, 30 *Item.js                     │
├──────────────────────────────────────────────────────────────┤
│ Controllers (23)  GameCtrl · OfflineCtrl · OnlineCtrl ·       │
│                   PropsOfflineCtrl · ComputerCtrl …           │
├──────────────────────────────────────────────────────────────┤
│ Logic units / behaviours  StatePlayDice · StateSelMove ·      │
│                   BehaviorBase · LogicUnitManager             │
├──────────────────────────────────────────────────────────────┤
│ Models (62)  GameInfoModel · PlayerInfoModel · GoodsModel ·   │
│              BackpackDataModel · MailModel · TaskModel …      │
├──────────────────────────────────────────────────────────────┤
│ Framework  DataModelManager · MessageCenter · UIManager ·     │
│            SceneManager · LocalManager · UITool · Version     │
├──────────────────────────────────────────────────────────────┤
│ TSDK  TsdkFacade → tsdk.js (23.7k lines) → native bridge      │
└──────────────────────────────────────────────────────────────┘
```

The framework is `FlyChessUI` — import-path frequency in `modules/` shows the spine:
`DataModelManager` (36 refs), `ConstDefine` (30), `UIManager` (25), `LocalManager` (13),
`MessageCenter` (12), `LogicUnitManager` (10).

**Communication is a global string-keyed bus, not props or events with types.** `MessageCenter`
dispatches by name against `MessageIDS` (~250 verbs), with a `setGlobalCacheMessage(bool)` flag used
to suppress re-entrancy during animations. This is the classic Cocos "everything is a singleton"
pattern — cheap to write, impossible to type, and the reason a typo'd message id fails silently.

### 2.2 Module census [V]

| Kind | Count |
| --- | --- |
| Panels | 96 |
| Inlets (lobby entry points) | 11 |
| Items (list cells) | 30 |
| Models | 62 |
| Controllers | 23 |
| Registered window IDs | 126 |
| Recovered modules | 420 |

126 window IDs against 96 panel files means ~30 windows are composites or runtime-generated
(alerts, animations, effects) rather than files.

### 2.3 The dual-mode split is the architecture

The client contains **two complete game drivers**:

| | `OnlineCtrl` | `OfflineCtrl` (766 lines) |
| --- | --- | --- |
| Dice | server (`CastResult`) | local, **weighted** (§6) |
| Move legality | server (`MoveResult.events`) | local engine |
| Turn order | server (`nextTurn`) | local |
| Settlement | server (`Settle`) | local `gameOver` |
| AI | server-side virtual match (§3.8) | `ComputerManager` + `CManager` |

They share the same view layer and the same `GameInfoModel`. The controller is selected by
`GameCtrlFactory` from `gameType`. This is a clean separation and the direct analogue of Ludo Base's
"one authority per match, chosen by the transport" — except Ludo World switches on **game mode**, not
on **connection liveness**, which is a materially simpler rule.

---

## 3. Server architecture

### 3.1 Service topology [V]

`tsdk.js` carries a full HuanLe-platform service map. Message-ID ranges and hosts identify the
services:

```
                    ┌──────────────────────┐
   client ─────────►│ Router (BookRouter)  │  ReqBookRouter{Uin,Time,RouteType,SvrType,SvrID}
                    └──────────┬───────────┘
                               │ sticky route
   ┌───────────────────────────┼────────────────────────────┐
   ▼                           ▼                            ▼
┌─────────────┐        ┌────────────────┐          ┌────────────────┐
│ LoginSvr    │        │ GameSvr "Lotus"│          │ PostSvr (mail) │
│ 16401-16406 │        │ 15801-15873    │          │ TSPostSvr      │
└─────────────┘        └────────────────┘          └────────────────┘
   ▲                           ▲                            ▲
   │  HTTPS CGI                │  WebSocket                 │
┌──┴──────────────────────────────────────────────────────────────┐
│ Aux: DirtySvr (word filter 18001) · Pricing/Goods (19100+) ·    │
│      LBS (17087) · EagleEye telemetry · PushMsgServer            │
└──────────────────────────────────────────────────────────────────┘
```

| Service | Message IDs | Purpose |
| --- | --- | --- |
| LoginSvr | `16401` LOGIN, `16402` HEARTBEAT, `16403` LOGOUT, `16405` QUERY_BASEINFO, `16406` KICK | auth + session |
| GameSvr ("Lotus") | `15801`–`15873` | room, play, match, settle |
| PostSvr | `TSPostSvr.*` | mail, friend hearts/beans |
| DirtySvr | `S2S_DIRTYSVR_WORD_FILTER: 18001` | chat profanity filter |
| Pricing/Goods | `19100` PRICING, `19101` BUY_GOODS, `19200` QUERY_CURRENCY | store |
| Ludo-specific | `38701`–`38708` | lucky bag, ad reward, red envelope |

The Ludo-specific range is tiny — **8 message IDs** — while the generic HG platform carries ~60. The
game-specific protocol surface is small because the platform does the heavy lifting. [V]

### 3.2 Wire format — TDR + a fixed head [V]

This is a **binary TDR (Tencent Data Representation)** protocol, not JSON. Every packet carries a
`CSHead`:

| Field | Type | Note |
| --- | --- | --- |
| `TotalLength` | int16 | framing |
| `Ver` | int16 | protocol version |
| `Seq` | int32 | sequence number |
| `DialogID` | int16 | account-type discriminator |
| `Uin` | uint32 | user id |
| `BodyFlag` | uint8 | body encoding flags |
| `Option` | buf[127] | `MSG_CSHEAD_MAXOPT_LEN = 127` |

Constants: `MAX_ROUTEKEY_LEN 128`, `MAX_ERR_STRING_LENGTH 128`, `MAX_EXTEND_INFO_LEN 1024`.

Encryption: `CryptoAlgorithmType { NONE: 0, TEA: 1 }` — **TEA** is declared in the protocol. The
implementation is not in the JS (native), so the key schedule is [X].

Auth login types: `LoginTypeWeixin 1`, `QQ_OpenId 2`, `WeixinGuest 3`, `QQ_PC 4`.
`DialogIDType`: `NONE -1`, `WX/QQ_Openid/WX_Guest -3`, `QQ_Pc -4`.

**Read this against Ludo Base:** your room protocol is JSON over a WebSocket, carrying
`{t:'intent_ack', intentId, data:{state, seq}}`. You have `seq` but no length framing, no version
field, and no per-packet `Uin` (auth is out-of-band via the session ticket). That is *fine* at
4-player scale — but it means your protocol has no cheap way to reject a desynchronised peer early,
which is exactly what `Ver` + `TotalLength` buy.

### 3.3 Router booking — the DO analogue [V]

```js
ReqBookRouter { Uin:uint32, Time:uint32, RouteType:uint16,
                RouteInfoLen:int16, SvrType:int16, SvrID:int16 }
BookRouteType { EBRT_NONE_BOOK_ROUTE: 0, EBRT_SVRTYPE_SVRID_BOOK_ROUTE: 1 }
```

The client asks the router to **reserve a sticky route** to a specific `(SvrType, SvrID)` pair, then
opens a WebSocket directly to that game server. This is Tencent's standard "预分配路由" pattern.

**This is architecturally identical to Cloudflare Durable Objects.** `SvrID` ↔ `idFromName(matchId)`;
the router ↔ the platform's placement layer; the sticky route ↔ DO affinity. Ludo Base already has
the better primitive and is not using it fully — `MatchRoom` is instantiated per match, but nothing
in the client reserves or *reports* which instance it landed on. See §10.4.

### 3.4 Protocol catalogue [V]

Game server (`TSHuanLeGameSvr`), verbatim IDs:

```
15801 C2S_HG_LOGIN              15815 S2C_HG_NOTIFY_GAME_DATA     15840 C2S_HG_ADDON_REBUY
15802 C2S_HG_LOGOUT             15816 C2S_HG_SITDOWN_FROM_VIEW     15852 C2S_HG_GIVE_GIFT_ONTABLE
15803 C2S_HG_SITDOWN            15817 C2S_HG_VIEW_FROM_SITDOWN     15853 S2C_HG_NOTIFY_GIVE_GIFT
15804 C2S_HG_STANDUP            15818 S2C_HG_CALL_PLAYER           15860 C2S_HG_KICK_PLAYER
15805 C2S_HG_CHANGE_SEAT         15819 C2S_HG_QUERY_TREASURE_BOX    15861 C2S_HG_FETCH_ROUND_FLOW_INFO
15806 C2S_HG_GET_INFO            15820 C2S_HG_OBTAIN_TREASURE       15862 C2S_HG_FETCH_ROUND_RANK_LIST
15807 C2S_HG_REPORT_INFO         15821 C2S_HG_TALKONTABLE           15863 S2S_HG_GET_GAME_DATA
15808 S2C_HG_NOTIFY_INFO         15822 S2C_HG_PUSHTABLEMSGS         15864 S2C_HG_NOTIFY_TAODOU_INFO
15809 S2C_HG_NOTIFY_GAME_EVENT    15824 C2S_HG_USE_ITEM             15865 S2S_HG_VIRTUAL_MATCH_QUERY
15810 C2S_HG_READY                15825 C2S_GET_EMOJ_PRICE           15866 S2S_HG_VIRTUAL_MATCH_NOTIFY
15811 C2S_HG_VIEW_SEAT            15826 C2S_HG_VIEW_PLAY              15867 S2S_HG_VIRTUAL_MATCH_SCORE
15812 C2S_HG_HELLO                15827 C2S_GET_ECSYS_INFO           15868 S2S_HG_VIRTUAL_MATCH_REBUY
15813 C2S_HG_PLAY                 15830 C2S_HG_ENROLL_MATCH           15869 C2S_HG_RENEW_DATE
15814 S2C_HG_WRAPPER_MESSAGE      15831 C2S_HG_CANCEL_ENROLL_MATCH   15870 S2S_HG_GET_GAME_SVR_INFO
                                 15832 S2C_HG_NOTIFY_PLAYER_SITDOWN 15871 S2S_HG_GAME_SO_HANDLE
                                 15833 S2C_HG_NOTIFY_PLAYER_READY   15872 C2S_HG_PLAY_WITH_AI
                                 15834 S2C_HG_NOTIFY_PLAYER_STATUS  15873 C2S_HG_PROTO_HEAD_PLAY
                                 15835 C2S_HG_SYN_MATCH_PLAYER_INFO
                                 15836 C2S_HG_GET_MATCH_SESSION
                                 15837 C2S_HG_GET_MATCH_PLAYERDETAIL
                                 15838 C2S_HG_GET_PLAYER_RANK_INFO
                                 15839 C2S_HG_GET_ROOM_PLAYER_INFO
```

Three things stand out:

1. **Seat lifecycle is a first-class protocol concern** — `SITDOWN`, `STANDUP`, `CHANGE_SEAT`,
   `VIEW_SEAT`, `SITDOWN_FROM_VIEW`, `VIEW_FROM_SITDOWN`. Seats and spectators are the same state
   machine with a transition verb. Ludo Base has no seat model at all: players are just connected
   peers, and spectating is a separate read-only sync path.
2. **`S2C_HG_WRAPPER_MESSAGE`** — a nested-envelope verb. The server can ship arbitrary inner
   messages, which is how they extend the protocol without a new top-level ID. [I]
3. **`C2S_HG_ADDON_REBUY`** — mid-match rebuy. That is a gambling-adjacent economy feature with no
   Ludo Base analogue (and probably no regulatory analogue for you either).

### 3.5 Auth and login [V]

```
client ──GET──► login-ludo.ihappystudio.com/.../GetPublicKey      (RSA public key)
       ──POST─► login-ludo.ihappystudio.com/.../Ludo_Happy_SafeLogin  (RSA-encrypted payload)
       ──POST─► ludo-login.ihappystudio.com/.../Ludo_Check_Can_Login
```

RSA is implemented **in the JS bundle** (a bundled jsencrypt-style library: PKCS#1 v1.5, evidenced by
the `length + 11` padding check and `BEGIN RSA PUBLIC KEY` emitters). So credentials are encrypted
client-side to a server-held key before the CGI call.

Then the socket layer authenticates again via `MSGID_C2S_HG_LOGIN` with `SIGType { HLGAME: 1 }`, and
`LotusAuthLoginType` (Weixin/QQ) — i.e. **two auth hops**: CGI for identity, socket login for session.

**Compare:** Ludo Base uses SIWE + a `sessions` table with SHA-256 tokens, and passes the session in a
header (never the query string — a good invariant). Ludo World's RSA-CGI hop is solving the same
problem (don't send a bearer token in cleartext) with a heavier primitive. Your approach is better.

### 3.6 The cast packet carries a client-chosen dice value [V] ⚠

`GameSoManager.requestCast` builds `TCMD_REQUEST_CAST`:

```js
var i = this.gameModel.GMDiceCount;
var n = new HuanLeGameSo.TCMD_REQUEST_CAST();
n.Reserve.tvalue = i;                       // ← client-supplied int on every cast
n.LeftPreCastNum.tvalue = this.gameModel.preDiceCounts.length;
...
if (1 === e && 0 !== this.playerModel.requstItemID) {   // paid item path
  if (s === PropsType.ControlCastData && r) {
    d.RoundItemData.ControlCastData.Point.tvalue = r;   // ← chosen dice face
  }
}
```

Two separate mechanisms put a client-chosen number into the cast request:

- **`Reserve`** — populated from `GMDiceCount`, which is set by a shipped `GMTool.js` debug panel
  (`SetGMDiceCount`) toggled by `GMToolSwitch.js`. Normally 0.
- **`ControlCastData.Point`** — the *paid* "control cast" prop, which legitimately sets the face.

The paid path is a product feature. The `Reserve`/GM path is a **debug hook that reaches the wire in
the release build**. Whether the server ignores it for non-GM accounts is [X] — but note that
`MsgID_UpdateGMToolStatus` exists, implying the client is *told* whether GM tools are active. [I]

This is worth recording for one reason: it shows the shape of the cheat surface they accepted. Ludo
Base's equivalent decision is already made and stricter — `wireSanitize.ts` strips power `type` on
the wire and the room re-derives state. Keep it.

### 3.7 Resilience ladder — the numbers the earlier reports lacked [V]

```js
// LotusConnection (game server)
this.aE = 6e5    // 600 s  hello/keepalive interval
this._E = 3e3    // 3 s    reconnect delay
this.DE = 10     // 10     max attempts
// hall connection
this.aE = 6e4    // 60 s
// another service
this.aE = 12e4   // 120 s
```

And a named offline taxonomy, which is the actual lesson:

```js
OFFLINE_REASON = {
  WS_IS_NULL: 3000, NET_IS_NOT_CONNECT: 3001, HELLO_RSP_TIMEOUT: 3002,
  SVR_CLOSE_CONNECT: 3003, HW_NET_IS_CHANGED: 3004, PLAY_DO_RECONNECT: 3005
}
```

Every transition fires an event with an attempt counter:
`EVENT_ID_NOTIFY_TRY_TO_RECONNECT {type, times}`, `..._RECONNECT_SUCC`, `..._RECONNECT_FAIL`,
`..._LOTUS_IS_OFFLINE {reason}`, `..._NET_STATE_CHANGED`. Attempts are also uploaded as a platform
attribute (`attrUpLoad`), so the counters reach analytics — not just the log.

**App-level reconnect** is a separate, simpler ladder (`AndroidReconnect.js`): read cached
`Uin` + `LoginType` → if absent, alert + reload login scene → else `ITopQuickLogin(provider)` silent
re-auth → re-enter. So: *socket* reconnect is 3 s × 10 with a reason code; *identity* reconnect is a
silent re-login. Two ladders, two failure modes, both named.

**This is the single most transferable thing in the APK.** Ludo Base has no in-match ladder at all:
`useAFKManager` lacks an `isLobbyConnected` guard, nothing reads `state.deadlineAt`, and the turn clock
never ticks in a room match. Ludo World's ladder is 15 lines of constants plus an enum.

### 3.8 Virtual match = server-side bot backfill [I]

`S2S_HG_VIRTUAL_MATCH_{QUERY,NOTIFY,SCORE_NOTIFY,REBUY}` plus `C2S_HG_PLAY_WITH_AI` and
`S2S_HG_GET_GAME_SVR_INFO`. The `S2S_` prefix means **server-to-server**: the matchmaking service asks
another service to stand up a virtual (bot-filled) match and receives score/rebuy notifications.

So their matchmaking fills empty seats with server-hosted bots, transparently to the client, and the
bot's score feeds the same pipeline as a human's. Combined with §6 (weighted dice per
`getRobotData(playerNum, level)`), this is a **tuned, server-authoritative opponent** — not a
simulation.

This is the most consequential product difference from Ludo Base, and it is an *economy* difference,
not a technical one: bots let them guarantee a full table at any hour, which lets them guarantee
short queue times, which is the retention driver. The cost is that a real player cannot distinguish
a bot from a human, and the dice are tuned in the house's favour to some degree. Ludo Base's
`useProvablyFairDice` forecloses that option permanently.

### 3.9 Region config [V]

`CgiUrlManager.getCgiUrl()` resolves at runtime from `window.cgiconfigdata`:

```js
if (cur_use == "sg_test_url")    → Singapore TEST,   curenv="singapore", inner=true
else if (cur_use == "hk_url")    → Hong Kong,        curenv="hongkong"
else                             → Singapore PUBLISH, curenv="singapore"
```

with a compile-time fallback (`inner` vs `publish` URL sets) and an explicit `build_is_used_inner_config`
flag. Three environments — HK, SG-test, SG-publish — switchable **without a rebuild**.

Also worth noting: the *inner* set points at `test-cgi.txwq.qq.com` and `test.ludo.qq.com`, which is
the debug configuration, not a leak. [V]

---

## 4. Data and schema

### 4.1 Remote config registry — 19 numeric buckets [V]

`ConstDefine.ConfigsType`. This is their whole live-ops surface, addressed by integer:

| id | Bucket | id | Bucket |
| --- | --- | --- | --- |
| 1000 | `UpgradeCfg` | 1010 | `BubbleConfig` |
| 1001 | `LudoCommonCfg` | 1011 | `ShopCfg` |
| 1002 | `RoomCfg` | 1012 | `CharmGift` |
| 1003 | `PlayerLevelCfg` | 1013 | `AdCfg` |
| 1004 | `StoreCfg` | 1014 | `RoomCfg_1.6.7` ← **versioned bucket** |
| 1005 | `LocalPushCfg` | 1015 | `EntryCfg` |
| 1006 | `GoodsCfg` | 1016 | `GrandPrixCfg` |
| 1007 | `OfflineProbability` | 1017 | `PopGiftBagCfg` |
| 1008 | `PlayerScoreCfg` | 1018 | `CgiUrlCfg` |
| 1009 | `StateConfig` | | |

Two design notes worth stealing:

- **`1014 = RoomCfg_1.6.7`** — they version a config bucket by *app version*, so an old client keeps
  reading its own schema while new clients read the new one. That is schema migration without a
  migration: cheap, and it works because the client asks for a bucket it understands. Ludo Base has
  hardcoded pool tiers; this is the concrete pattern to replace them with.
- **`1018 = CgiUrlCfg`** — the service map itself is remotely configurable. You can move a region
  without shipping.

### 4.2 Runtime game state schema [V]

From `GameInfoModel` (in the bundle, not `modules/`):

```
WinNum  _gameType  playerNum  playerColor  names[]  playerTypes[]  teamCodes[1,2,1,2]
SerchLabel  CurSeat  PreSeat  DiceCount[]  activeSeatID  gameStatus  OnTurn  LeftSecond
CastSecond  MoveSecond  MaxDullSecond  MaxReCastCount  ReCastItemPrice  ReCastDiamondPrice
ShowGameOver  ActiveGlobalItemNum  ActiveGlobalItem[]  ItemPosInfo[]
PrposDiceCount  LastPrposDiceCount  PropsLuckyPoint  PlayerStatusInGame  GMDiceCount
```

Note `teamCodes: [1,2,1,2]` — seats 0+2 are team 1, seats 1+3 are team 2. **That is diagonal
teammates, i.e. exactly Ludo Base's `TEAM_PAIRINGS` (Green+Blue vs Red+Yellow).** Two independent
implementations converged on the same seating rule. Useful as external validation. [V]

`PlayerInfoModel` adds the per-seat runtime:

```
TrustState  AIDiceControl  CanContinueDice  ControlNum  ControlPanelPos  GameRound
PropsItemNum  PropsItemPosition  luckyPoint  luckyPointGameRound  specialLuckySeatId
UsedPropsItemID  requstItemID  requstItemID  remainRecallNum  nextRecallPrice  waitRecallCD
winID[]  loseID[]  leaveID[]  playerRankList  planeInfos  searchNum  searchPanelNum
```

`AIDiceControl` is a **model-level field for AI dice control** — the §6 finding confirmed at the
schema layer, not just the call site.

### 4.3 Persistence — deliberately thin [V]

Nine user keys, all display cache:

```
LocalData_Uin  LocalData_NickName  LocalData_PotraitUrl  LocalData_Money
LocalData_PlayGameCount  LocalData_WinGameCount  LocalData_playerScore
LocalDate_LoginType  LocalDate_lastOnlineType
```

Plus ad-cadence counters (`AdShowCount`, `AdGameCount`, `AdConfirmAlertCount`, `PopLocalNum`,
`luckSevenDiceNum`, `luckPanelState`, `SaveCurrentWeekTiem`, `PlayerScoreCfg`,
`AutoShowSpinOnlyOne`).

**There is no local ledger, no offline queue, no optimistic state.** The wallet, inventory, and match
history are server-only. On Facebook Instant, the same role is played by `FBInstant.player.setDataAsync`
/ `getDataAsync` (cloud save, with a 3-attempt retry).

The lesson for Ludo Base: your `RoomClient.pendingIntents` is an **optimistic queue with a 10 s
timeout** — a design Ludo World deliberately avoids by making every intent fire-and-forget and every
result server-pushed. Your approach is more responsive; theirs is simpler to reason about. If your
intent timeouts keep biting, this is the alternative.

### 4.4 Error taxonomy [V]

```js
ERRNO = {
  ERR_SUCC: 0,                ERR_PLAYER_NOT_ON_TURN: 10,  ERR_PLAYER_HAS_CAST: 11,
  ERR_PLAYER_NOT_CAST: 12,    ERR_RECAST_USE_UP: 13,        ERR_PLAYER_CAST_TOO_FAST: 14,
  ERR_GET_ITEM_FAIL: 15,      ERR_COST_ITEM_FAIL: 16,       ERR_DIAMOND_NOT_ENOUGH: 17,
  ERR_COST_DIAMOND_FAIL: 18,  ERR_POINT_TOO_SMALL: 19,      ERR_PLAYER_NO_PLANE: 20,
  ERR_INVALID_PLANE: 21
}
```

Semantics worth noting: `ERR_PLAYER_CAST_TOO_FAST` (14) is **rate limiting as a protocol error**, and
`ERR_PLAYER_CAST_TOO_FAST`/`ERR_RECAST_USE_UP` imply re-cast is server-counted. `ERR_DIAMOND_NOT_ENOUGH`
(17) proves diamonds are a server-checked currency.

**Ludo Base gap:** `RoomClient` collapses every rejection into `ROOM_INTENT_FAILED`
(`reject(new Error('[CODE] …'))`), so `code === 'POWER_ARMED'` in `useGameActions` is dead code. Their
design — a typed error enum the client can branch on — is the fix.

### 4.5 Config encoding: string matrices [V]

```js
parseTakeOffProbability: function(e) {
  for (var t = e.split(";"), a = [], i = 0; i < t.length; ++i) a[i] = t[i].split(",");
  return a;
}
```

The probability tables ship as **semicolon-delimited rows of comma-delimited values**, i.e. a 2D
matrix serialised into a string. And the loader:

```js
loadConfig: function() {
  l = i.default.getConfigByKey(1007);            // remote bucket
  l ? h() : n.default.loadConfig("config/OfflineProbability").then(...)   // local fallback
}
```

**The local fallback asset is not in the APK.** So the tables exist only server-side. See §6.

---

## 5. Game rules and board math

### 5.1 Constants [V]

```
PlayerChessMaxNum 4   CHESS_COUNT 4   TEAM_CHESS_COUNT 8   AllPlayerChess 16
DiceCountByTakeOff 6  SpecialMapPoint 8   EachMonopolizeID 6
CanUseDoubleGridIndex 46   NoSafetyGridIndexPos 50   OPEN_PROTECTIVE_COVER_MAX_INDEX 55
PickChessMax 7   ControlMaxDiceNum 6   PropsItemNum 3
```

### 5.2 Board geometry per mode [V]

| Mode | Players | `gridMaxNum` (board nodes) | `playerMaxGrid` (path len) | `gridRoundCount` (ring) | `gridRoundLastNum` | `playerSpaceGridCount` |
| --- | --- | --- | --- | --- | --- | --- |
| Classic | 4 | 76 | 57 | 52 | 76 | 13 |
| MiniMap | 4 | 40 | 30 | 28 | 40 | 7 |
| Five | 5 | 95 | 70 | 65 | 71 | 13 |
| Six | 6 | 114 | 83 | 78 | 84 | 13 |

Derived rule for the 13-per-player modes:

```
ring      = players × 13        # 4→52, 5→65, 6→78
pathLen   = ring + 5            # 4→57, 5→70, 6→83
lastIndex = pathLen - 1
```

Two honest caveats:

- **MiniMap breaks the rule** (ring 28 = 4×7, path 30 = ring+2, not +5). Either it has a 2-cell home
  lane or a different index base. I did not resolve which. Do not generalise from it.
- **`gridRoundLastNum` is inconsistent in their own code**: Classic sets it to 76 (equal to
  `gridMaxNum`, the total board node count) while Five/Six set ring+6. One of the two is wrong, or
  they mean different things in different branches. This is a bug-shaped inconsistency, not a rule.

### 5.3 Special points (safe squares) [V]

Classic `[0, 8, 13, 21, 26, 34, 39, 47]`; Five adds `52, 60`; Six adds `65, 73`. Pattern: each seat's
start (0, 13, 26, 39…) plus start+8 — i.e. **two safe cells per quadrant**, entry and a star 8 ahead.
`SpecialMapPoint: 8` for the 4-player board.

### 5.4 Mechanics that differ from Ludo Base

| Mechanic | Ludo World | Ludo Base today |
| --- | --- | --- |
| Take-off | exactly a 6 | 6 to leave base |
| Three sixes | forfeit turn after N consecutive (`ContinuousTime >= 3 → nextPlayer()`) | 3×six skip |
| Exact finish | `playerMaxGrid - 1 - GridIndex` must be reachable | exact-finish 57 |
| Protective cover | opens past index 55, immune to capture | `activeBoost` / `powerTiles` (different model) |
| Re-cast / recall | **paid**, `MaxReCastCount` + `ReCastItemPrice` + `ReCastDiamondPrice` + `waitRecallCD` | none |
| Undo | seat 0 only, gated by `IsShowUndoEntrance()` | none |

The **recall economy** is the most interesting mechanic Ludo Base lacks: you can take back a bad roll,
it costs gold (and diamonds when gold runs out), it has a cooldown (`waitRecallCD`), and the price
escalates (`nextRecallPrice`). That is a monetised *dopamine repair* — selling relief from a bad
outcome. It pairs exactly with §6's weighted dice: the die can hurt you, and relief is purchasable.

---

## 6. Dice, fairness, and what the APK actually contains

### 6.1 The mechanism [V]

`OfflineCtrl.getDiceCountByStatus` (and `ComputerManager` for bots) sample weighted tables instead of
`1 + floor(random()*6)`:

```js
// a) take-off pity — table indexed by consecutive failures
var t = this.getProbabilityDice(getPersonData().takeOffProbability[this.cantTakeOffTime[e]]);
t == DiceCountByTakeOff ? this.cantTakeOffTime[e] = 0 : this.cantTakeOffTime[e]++;

// b) normal move — a 6-entry weight vector, NOT uniform
return this.getProbabilityDice(getPersonData().moveProbability);

// c) finish assist — exact roll to finish, decaying by attempt count
var u = getPersonData().finalProbability[c];
if (d <= parseInt(u)) return this.gameModel.playerMaxGrid - 1 - h;

// sampler
getProbabilityDice: function(e) {
  if (e) { var t = Math.floor(100*Math.random()), a = 0;
    for (var i=0;i<e.length;++i) if ((a += parseInt(e[i])) >= t) return i+1; }
  return 6;
}
```

`getProbabilityDice` walks a cumulative percentage against `random()*100` — so each table is **six
percentages summing to ≤100**, with the remainder falling through to `6`. That `return 6` default is
itself a bias: any slack in the table becomes a six.

### 6.2 The AI can aim at captures [V]

`ComputerManager.getDiceCountByStatus` scans forward up to `PickChessMax` (7) cells, tests
`CanKickChess`, and collects the distances that would capture:

```js
for (var g = 1; g < ConstDefine.PickChessMax; ++g) {
  var I = this.checkerBoard.grids[f];
  I && I.CanKickChess(h, M) && (a.playerType == PT_ROBOT ? (0 === M.SeatID && c.push(g)) : c.push(g));
}
```

Note the `0 === M.SeatID` branch: for a robot, only captures against **seat 0 (the human)** are
collected. The AI's dice weighting is aimed at the player.

### 6.3 The tables are not in the APK — this is the key correction [V]

```js
OfflineProbabilityModel.loadConfig: function() {
  l = CustomConfigLoader.getConfigByKey(1007);     // remote
  l ? h() : LocalConfigLoader.loadConfig("config/OfflineProbability").then(...)
}
```

`config/OfflineProbability` is **absent** from the extraction (verified: no matching asset anywhere in
`extracted/`). The bucket is `1007`. Structure per `getRobotData`:

```
{ Person: <table set>,
  Robot: { One|Two|Three|Four:            // by player count
             { LevelOne|LevelTwo|LevelThree: <table set> } } }
```

So: **4 player-counts × 3 difficulty levels × 3 table types**, all server-side.

**Therefore: nobody can state their dice distribution from this APK.** Any report claiming exact
percentages is fabricating them. What is provable is the *shape* — pity, weighting, finish-assist,
capture-aiming — and the fact that the tuning is remotely adjustable without a release.

### 6.4 Why this matters for Ludo Base

Your `useProvablyFairDice` + Edge `roll-dice` receipts + `match_rolls` table make the roll verifiable
after the fact. Ludo World's model is the inverse: the roll is *unverifiable by design* and used as a
tuning dial. These are not two implementations of the same feature; they are two different products.

The competitive doc's advice ("don't copy") is right, but the sharper framing is: **their dice are a
retention/monetisation instrument, and yours are a trust claim.** If you ever add a casual/offline AI,
the honest design is to disclose weighting, keep it out of any CHIPS-bearing match, and never let it
touch a receipted roll. `AIDiceControl` existing as a *model field* is the cautionary example: once
the field exists, the product pressure to use it in ranked play is permanent.

---

## 7. Economy and monetisation

### 7.1 Currencies and goods [V]

```
GoodsCfgId = { Gold: 40000001, Skin: 50000001, Rests: 60000001, LuckyBox: 70000001,
               ThemeEmoji: 80000001, LimitEmoji: 90000001, Gift: 100000001 }
```

Gold + diamonds (`ERR_DIAMOND_NOT_ENOUGH`), with six cosmetic/gift categories. Dice skins are
per-player (`diceSkinId`) with animated atlases (`getAnimatedName()`), rendered by `Dice.js`.

### 7.2 Props — four, carry three [V]

| ID | Enum | Effect |
| --- | --- | --- |
| 1 | `LuckyNumData` | lucky number |
| 2 | `DoubleCastData` | double cast (sum rendered as `DiceCount / 2` double-dice UI) |
| 3 | `ControlCastData` | choose the face; bounded by `ControlMaxDiceNum 6`, sent as `ControlCastData.Point` |
| 4 | `AvoidKickData` | shield from capture |

`PropsItemNum: 3` carry limit; `PropsType.TypeMax: 5`.

**Compare with Ludo Base's Power v3** (5 hidden tiles + timed inventory). Ludo World's props are
*pre-roll modifiers* (change the die, protect the token); yours are *board-space pickups*. Theirs are
purchasable inventory, yours are positional. Both are valid; theirs monetises better because the
purchase decision happens at the moment of anxiety.

### 7.3 Live-ops surfaces [V]

- **Lucky bag** (`38701`–`38703`), **ad reward** (`38704`–`38705`), **red envelope** (`38706`–`38708`)
- **Lucky Seven** (`LuckySevenPanel` + `Roll` CGI) — a dice-driven lottery
- **Elimination / XXL** (`EliminatGamePanel`, `XXLServer/StartEliminat`) — a tournament mode
- **Grand Prix** (`GrandPrixPanel`, `GrandPrixCfg`)
- **Sign-in** (`SignInPanel`, `SignInAwardIncreasePanel`), **tasks** (`TaskPanel`), **mail**
- **Charm** (`charmModel`, `CharmGift` config) — gifting raises a visible charm stat
- **DiBao / FuDai** (`DiBaoPanel`, `NewDiBaoPanel`, `FuDaiPanel`) — paid loot/gift packs
- **Relief funds** (`CReqGetReliefFunds`) — bankruptcy bailout, a retention floor

That is **twelve distinct retention/monetisation loops**, each with its own config bucket and CGI.
Ludo Base's CHIPS plan has missions + seasons + a marketplace; it does not yet have a relief fund, a
lottery, a tournament, or a charm/gifting loop.

### 7.4 Ads [V]

`AdsCfgModel` reads remote slots with per-placement `isOpen` flags, split `app` / `mini`:
`Interstitial{app,mini}`, `Banner{select,exit}`. Every slot is remotely kill-switchable, and ad
cadence is tracked locally (`AdShowCount`, `AdGameCount`, `AdConfirmAlertCount`).

**SDK inventory** (dex strings, by reference count): `com/facebook/share` 353, `com/appsflyer` 330,
`com/facebook/internal` 328, `com/facebook/appevents` 269, `com/facebook/ads` 198, `com/adjust/sdk`
161, `com/facebook/login` 138, `com/google/android/gms/ads` 6. [V]

Facebook Audience Network + AdMob, **AppsFlyer and Adjust simultaneously**. Ludo King runs ~9 ad
networks through AppLovin MAX and *no* MMP. Two opposite strategies: World maximises attribution
fidelity, King maximises fill rate.

---

## 8. User-side surfaces and flows

### 8.1 Window census — 126 [V]

| Domain | Windows |
| --- | --- |
| **Boot / compliance** (12) | `LoadingPanel` `AgreementPanel` `AgreementAndDataPanel` `AlertAgePanel` `ChooseAgePanel` `AlertDMAPanel` `AlertEuropeanPanel` `AlertUEPanel` `AlertDataPanel` `DataDEAPanel` `RegionPanel` `AlertForABtest` |
| **Auth** (3) | `MoreLoginPanel` `FacebookConnectPanel` `ContinueGuestPanel` |
| **Lobby** (25) | `MainSelectPanel` `GameModeSelectPanel` `OnlineSelectPanel` `OfflineSelectPanel` `OnlinePanel` `Online2Panel` `OfflinePanel` `LocalTeamPanel` `TeamUpOnlinePanel` `MiniMapPanel` `ComputerPanel` `FriendsPanel` `AddFriendPanel` `ChatPanel` `MainChatPanel` `NoticePanel` `AnnouncementPanel` `MailPanel` `RankPanel` `PlayerInfoPanel` `LevelProgressPanel` `LevelUpPanel` `HeadSelect` `NewHandGuide` `Setting` |
| **Game** (20) | `GamePanel` `GameStart` `GameOver` `GameWinEffect` `WinNode` `ChessArriveAnim` `TrailAnim` `Direction` `InGamePlayerInfo` `KickEmoji` `LeaveGameAlert` `RestartBtn` `LocalGameOver` `SelectDicePanel` `PropsPrompt` `PropsGetPanel` `PropsUsedExplainPanel` `PropsSharePanel` `PropGuidePanel` `ShowDetailProps` |
| **Economy** (22) | `ShopPanel` `StorePanel` `MysteryShopPanel` `BackpackPanel` `BuyEmojiPanel` `InsufficientCoinPanel` `PrizePanel` `ReceiveAward` `SignInPanel` `TaskPanel` `DiBaoPanel` `NewDiBaoPanel` `FreeCouponPanel` `FirstCostPanel` `EndlessGiftPanel` `PopGiftBagPanel` `FuDaiPanel` `InvitePresent` `SharePresent` `SharePanel` `ShareGamePanel` |
| **Activity** (14) | `EliminatActivityRulePanel` `EliminatGamePanel` `GrandPrixPanel` `LuckSevenPanel` `LuckSevenResultPanel` `LuckSevenRulePanel` `RedEnvelopePanel` `MinutePanel` `AssessPanel` `FeedDackPanel` `ReportPanel` `WebViewPanel` `AdvertisementPanel` `Invaild` |

(The typos are theirs: `PropsPromtPanel`, `SerchPlayer`, `FeedDackPanel`, `DataDEAPanel`, `Invaild`.)

### 8.2 The compliance suite is the most under-appreciated part [V]

Twelve boot/compliance windows before the lobby, including an **age gate** (`ChooseAgePanel` +
`AlertAgePanel`), a **DMA-specific** notice (`AlertDMAPanel`), an **EU-specific** notice
(`AlertEuropeanPanel`), data-consent (`AgreementAndDataPanel`, `AlertDataPanel`), and a **DSA/DEA**
panel (`DataDEAPanel`). Plus `RegionPanel` and `AlertForABtest`.

For a children-adjacent casual game shipping into the EU, that is the minimum credible posture, and
it took 12 windows. Ludo Base has none of this and is planning paid pools with real value — the
competitive doc's "legal issue-spot before Phase-1" item (A7) is under-scoped if this is the bar.

### 8.3 Turn lifecycle and AFK [V]

Server-supplied per-match timers: `CastSecond` (dice window), `MoveSecond` (token selection),
`MaxDullSecond` (inactivity watchdog), `LeftSecond`/`OnTurn` (live countdown). All default to 0 in the
model and are filled from the server — so the **client cannot invent a clock**. Compare Ludo Base,
where `useGameTimer` mints `Date.now()+15s` locally and nothing reads `state.deadlineAt`.

AFK takeover is a **server command**, not a client bot:

```js
t.requestTrust = function(e) {
  var t = new HuanLeGameSo.TCMD_REQUEST_TRUST();
  t.Trust.tvalue = e;
  this.sendGameMessage(LUDO_MSG_REQUEST_TYPE.CMD_REQUEST_TRUST, t);
};
```

`TrustState` (托管) → `CMD_REQUEST_TRUST` → the server plays the seat. The client does not simulate
turns on the player's behalf. This is the correct design and the one Ludo Base should copy: your
`useAFKManager` currently has no lobby guard and no server authority, so an AFK player's seat is
undefined.

### 8.4 Session lifecycle [V]

```
boot → compliance → login (RSA CGI) → socket login → lobby
  → mode select → room (SITDOWN/READY) → game (CAST/MOVE) → Settle
  → GameOver → back to room (READY again) | leave
```

Reconnect is orthogonal at every stage: socket ladder (3 s × 10, reason-coded) or identity ladder
(silent `ITopQuickLogin`). The room is **not destroyed** on disconnect — `RconnectInfo` rehydrates.

---

## 9. Ludo Base comparison, axis by axis

| Axis | Ludo World 2.1.10 | Ludo Base (today) | Verdict |
| --- | --- | --- | --- |
| **Client** | Cocos 2.x, 96 panels, 62 models, global string bus | Next 16 / React 19, GSAP, typed hooks | Different constraints; theirs scales screens, yours scales surfaces |
| **Wire protocol** | binary TDR + `CSHead` (len/ver/seq/uin), TEA | JSON over WS, `seq` only, header auth | **Yours is simpler and safer.** No need for TDR at 4 seats |
| **Session auth** | RSA-CGI + socket login (2 hops) | SIWE + SHA-256 session token in header | **Yours is better.** RSA-in-JS is legacy |
| **Route/authority** | `BookRouter` → sticky `SvrID` | DO `MatchRoom` per match | **Yours is the better primitive, under-used** |
| **Room authority** | server-only, client is a renderer | DO when connected, P2P host otherwise | Theirs is simpler; yours is more resilient, harder to reason about |
| **Resilience** | named reason enum, 3 s × 10, 600 s hello, counters → analytics | none in-match; clock never ticks | **Their clear win.** Copy this first |
| **AFK** | server `CMD_REQUEST_TRUST` | `useAFKManager`, no lobby guard | **Their clear win** |
| **Error surface** | typed `ERRNO` 0–21 | collapsed to `ROOM_INTENT_FAILED` | **Their clear win** |
| **Config** | 19 numeric buckets, versioned (`RoomCfg_1.6.7`), region-switchable | hardcoded tiers + env | **Their clear win** |
| **State schema** | 62 models, single mutable `GameInfoModel` | typed `GameState` in `lib/types.ts` | **Yours is better typed**; theirs is better at live-ops |
| **Dice** | weighted, remote-tuned, capture-aimed AI | provable receipts (`match_rolls`) | **Yours is the differentiator** |
| **Settlement** | server-invisible | on-chain pool + dual-sign (planned) | **Yours is novel and unproven** |
| **Economy loops** | 12 (lottery, tournament, relief, charm, red envelope…) | missions + seasons (planned) | **Their breadth wins**; yours has a real sink |
| **Compliance** | 12 boot windows incl. age/DMA/EU | none | **Their clear win**, and it gates your paid pools |
| **Bot backfill** | `S2S_VIRTUAL_MATCH` + tuned bots | `aiEngine.ts` offline only | Theirs is an economy feature, not a tech one |
| **Persistence** | 9 display keys, no local ledger | Supabase + DO + intent queue | Yours is heavier and correct for on-chain |
| **i18n** | Cocos `LanguageData` packs (not in APK) | none | Both unproven here |

### 9.1 The three things that actually matter

1. **They solved the boring resilience problems and you have not.** Reason codes, retry ladders,
   server-issued AFK, typed errors, remote config. None of it is novel; all of it is missing, and all
   of it is cheap relative to what you have already built.
2. **You solved the trust problem and they cannot follow.** Provable dice + visible settlement is a
   structural moat, not a feature. Every recommendation below must preserve it.
3. **They have twelve economy loops and you have two.** Breadth is where they make money; depth is
   where you differentiate. Do not chase breadth before the value track is live.

---

## 10. Recommended technology for Ludo Base

Ordered by leverage. Each item names the artifact to touch.

### 10.1 Copy the resilience ladder — highest leverage, lowest cost

Adopt the *shape* of `OFFLINE_REASON` + `{type, times}` events:

- Add `lib/roomCodes.ts`: a closed enum of disconnect/reject reasons
  (`NET_DOWN`, `HELLO_TIMEOUT`, `SOCKET_CLOSED`, `PEER_LEFT`, `AUTH_EXPIRED`, `INTENT_TIMEOUT`).
- Emit `room_reconnect_attempt{reason, attempt}` to your telemetry on every retry from
  `hooks/usePeerManager.ts` and the room client.
- Constants to start from, borrowed from their measured values: **3 s base delay, 10 attempts, 60 s
  liveness ping** (their hall), 600 s for the game socket.

Their exact numbers are tuned for a native socket on mobile networks; your WebSocket/DO path should
start at 3 s × 10 and tune from the dashboard.

### 10.2 Make the turn clock server-owned

Port `CastSecond` / `MoveSecond` / `MaxDullSecond` into `MatchRoom`:

- The DO owns the deadline and sends `deadlineAt` (it already does — nothing reads it).
- `useGameTimer` must render `deadlineAt - Date.now()`, never mint its own.
- `shouldRunMatchTimer` must not require `connectionStatus === 'connected'` via
  `useMatchStates` gated on `isLobbyConnected` — that gate is why the clock never ticks in a room
  match.
- AFK: replace client-side `useAFKManager` with a DO alarm that auto-plays and broadcasts, mirroring
  `CMD_REQUEST_TRUST`. Their `TrustState` is per-seat and server-visible; yours must be too.

### 10.3 Adopt a typed rejection surface

Replace `reject(new Error('[CODE] …'))` in `RoomClient` with a structured `RoomError { code, detail }`
so `useGameActions` can branch on `POWER_ARMED` again. Their `ERRNO` table (0–21) is the model:
enumerate every reason the room can say no, and never invent a new one inline.

### 10.4 Formalise the route/instance identity

You already have the better primitive. Make it observable:

- Room URL/join response should return the **DO instance identity** (or a hash of it) so clients and
  logs can correlate a match to an instance — their `SvrID` analogue.
- Add a `roomInstance` field to the intent ack and to `match_rolls`, so a post-mortem can tell
  "the room moved" from "the client lied".
- If you ever shard, `idFromName(matchId)` + a capacity hint is exactly their `BookRouter`.

### 10.5 Replace hardcoded tiers with a versioned config registry

Their pattern, adapted:

- `config` table (or KV) with numeric keys and a `schema_version`; `RoomCfg_1.6.7` proves the
  versioned-bucket trick works with old clients in the wild.
- Sign the payload; the client verifies before applying (their `CgiUrlCfg` is unsigned — do better).
- Buckets worth defining now: `PoolTiers`, `FeeCaps`, `SettleWindows`, `RpcList`, `FeatureFlags`,
  `AdSlots`.
- Encode matrices as strings only if you must; for JSON you should not need their `a,b;c,d` hack —
  that exists because their transport is a string-keyed config blob.

### 10.6 Build the compliance surface before the paid pools

Twelve windows is the real bar. Minimum viable for you: age gate, region gate, ToS/privacy acceptance
with a stored record, and a data-consent panel that distinguishes wallet-only from analytics. Their
`AlertDMAPanel` / `AlertEuropeanPanel` split is worth mirroring if EU users are in scope — and for a
Base/Farcaster audience they probably are.

### 10.7 What not to take

| Don't | Why |
| --- | --- |
| TDR/TEA binary protocol | Your JSON + `seq` is sufficient at 4 seats; TDR buys bytes you don't need and costs debuggability |
| RSA-in-JS login | SIWE + session token is strictly better |
| `Reserve`/GM dice field on the wire | You already strip power `type` via `wireSanitize.ts`; never add a client-chosen roll |
| Weighted dice anywhere near CHIPS | It would invalidate `match_rolls` as evidence |
| 12 economy loops at once | Breadth without a value track is how the burn/emission gap widens |
| `res/`-style obfuscation | You ship a web app; obfuscation buys nothing and hurts debugging |

### 10.8 If you want one number to chase

Their reconnect ladder is **3 s delay, 10 attempts, 60 s liveness**. Pick that as your in-match SLO
floor: any match that cannot re-establish within 30 s should be declared dead and refunded, not left
in limbo. That single rule converts their operational discipline into your settlement guarantee — and
it is something they cannot copy, because their settlement is invisible.

### 10.9 Board kinematics & animation timing overhaul

Ludo Base currently animates token hops via GSAP FLIP over a sluggish ~1.3 s budget in `BoardTokens.tsx`,
leading to perceived input lag on web and low-end mobile. Ludo World's exact timing parameters
(extracted from `Checkerboard.js:350-356` and `Dice.js:143-149`) establish the standard for a snappy,
tactile arcade cadence:

| Action | Exact Ludo World Sequence | Net Time | Action for Ludo Base |
| :--- | :--- | :--- | :--- |
| **Cell Hop (Per Step)** | `delay(0.02s) -> moveTo(0.12s) -> delay(0.02s)` | **0.16 s** / cell | Replace monolithic 1.3 s tween with **0.16 s per hop** stepped tweens; trigger jump sound per hop. |
| **Capture Rewind** | Cell-by-cell backward rewind at `moveTo(0.01s)` + final yard drop `moveTo(0.16s)` | **~0.3–0.6 s** total | Instead of instant snap, animate captured token rapidly retracing path backward into base, spawning crying face (`daku`). |
| **Yard Take-off** | `delay(0.13s) -> moveTo(0.16s)` | **0.29 s** | Smooth lift and placement onto starting tile index 0. |
| **Dice Spin & Settle** | Spin duration `0.3s` (`Dice_default`) + settle duration `0.6s` | **0.90 s** total | Tune `LudoDice.tsx` 3D/CSS rotation: 300 ms spin, snap face at 300 ms, settle delay 600 ms before `MOVE` highlight. |

### 10.10 Multi-token stacking cluster geometry (`overlayPos`)

Handling multiple tokens occupying the same tile without visual occlusion or hitbox clipping has been an
open layout challenge in `BoardTokens.tsx`. Ludo World's verified geometric solution (`GameInfoModel.js:414`,
`Checkerboard.js:125-130`) is clean and directly portable:

- When >1 tokens share a cell, their scale drops to **`0.4`**.
- They are arranged in a 2×2 coordinate quadrant offset from tile center:
  ```javascript
  overlayPos = [
    { x: -17, y:  12 }, // Quadrant 1 (top-left)
    { x:  15, y:  12 }, // Quadrant 2 (top-right)
    { x: -17, y: -21 }, // Quadrant 3 (bottom-left)
    { x:  15, y: -21 }  // Quadrant 4 (bottom-right)
  ];
  ```
- **Z-indexing:** Tokens layer by arrival order (`SetNodeLevel`). When leaving the shared tile, the active
  token scales smoothly back to `1.0` before initiating hops.

### 10.11 Upgrading bot decision heuristics (`lib/aiEngine.ts`)

Ludo World's single-player / bot decision pipeline (`StateSelMove.js:52-144`) implements a strict 5-stage
heuristic cascade that avoids the erratic play of naive greedy bots:

1. **`eatChess` (Capture Priority):** Scan all legal moves. If any move lands on an opponent token on an
   unsafe tile (`!isSpecialPoint`), take it immediately.
2. **`collideChessBack` (Threat Avoidance):** Scan 1–6 cells behind all own active tokens. If an opponent
   piece threatens an active token from behind, prioritize advancing that threatened token to safety.
3. **`missGrid` (Safe-Star Seeking):** If no capture or immediate escape exists, prioritize moves landing
   on safe star points (`[0, 8, 13, 21, 26, 34, 39, 47]`).
4. **`collideChessBefore` (Pursuit Positioning):** Prioritize advancing tokens into attack range (1–6 cells)
   behind opponent tokens.
5. **`getBestMoveIndex` (Endgame Push):** Tie-breaker: advance the token with the highest `GridIndex`
   (furthest along track, closest to goal).

Porting this exact cascade into `lib/aiEngine.ts` dramatically improves Rookie/Pro/Master bot play without
introducing unfair dice manipulation.

### 10.12 Interactive emotes & seat-to-seat projectiles (`GiftAnimManager`)

Competitors maintain high session engagement during long 4P matches through interactive seat-to-seat thrown
projectiles (`EmojiModel.js:95-115`, `GiftAnimManager.js`).

- **Artifact inventory:**
  - `zhadan` (Bomb) — flips across the board and explodes over opponent's avatar (4 s animation).
  - `xiaogui` (Ghost) — floats to target avatar and haunts.
  - `qiqiu` (Water Balloon) — flies and pops over target seat (6 s animation).
  - `dangao` (Cake/Pie) — splatters directly across opponent's profile picture.
- **Architectural fit for Ludo Base:**
  - Transport already exists: the public Supabase Realtime broadcast topic `game-room-<roomCode>` carries
    non-authoritative intents, chat, and emotes (`AGENTS.md` Rule 3).
  - Emote and gift projectiles require **zero blockchain state or transaction fees**, running purely as
    client-side CSS/canvas overlays across seat coordinates.

### 10.13 Prioritized implementation roadmap

| Track | Priority | Concrete Deliverables | Target Files |
| :--- | :--- | :--- | :--- |
| **Track 1: Netcode & Turn Authority** | **P0** | Server-owned `deadlineAt` in DO; client renders `deadlineAt - Date.now()`; DO alarm auto-play on `MaxDullSecond`; typed `RoomError` enum. | `src/room/MatchRoom.ts`, `hooks/useGameTimer.ts`, `hooks/useGameActions.ts`, `lib/roomCodes.ts` |
| **Track 2: Kinematics & Board Polish** | **P1** | Stepped 0.16 s hops per cell; 0.01 s capture rewind with crying emote; 2×2 quadrant multi-token stacking at 0.4 scale; 0.9 s dice cycle. | `app/components/BoardTokens.tsx`, `app/components/LudoDice.tsx` |
| **Track 3: AI Heuristic Upgrade** | **P2** | 5-stage decision cascade (`eatChess` → `collideChessBack` → `missGrid` → `collideChessBefore` → `getBestMoveIndex`). | `lib/aiEngine.ts` |
| **Track 4: Social & Live-Ops** | **P2** | Seat-to-seat projectile throw animations over Realtime broadcast; signed versioned remote config registry (`config.json`). | `app/components/Board.tsx`, `app/components/EmoteDrawer.tsx`, `lib/config.ts` |

### 10.14 State synchronization: Event-deltas vs. monolithic snapshots

In Ludo World, the server does not emit the full 57-tile board state on every action. It emits
authoritative **discrete action events** (`MoveResult.events` containing `EventKick`, `EventPick`,
`EventFinish`) alongside an incrementing `seq` counter (`MessageIDS.js`). The client applies the delta
to its local `GameInfoModel`. Full state payloads (`MsgID_RconnectInfo`) are strictly reserved for initial
join and reconnection rehydration.

**Application for Ludo Base:**
Currently, `src/room/MatchRoom.ts` serializes and broadcasts the entire `GameState` object (~3–5 KB JSON)
across WebSockets on every dice roll and token move. As turn frequency increases, this introduces avoidable
serialization overhead and JSON parsing jank on mobile.
* **Architecture Shift:** Adopt a hybrid delta model.
  * *Turn actions (`MOVE_TOKEN`, `ROLL_DICE`):* Emit compact delta events `{ type: 'MOVE', seat, tokenIdx, from, to, seq, events: ['CAPTURE' | 'FINISH'] }` (~150 bytes).
  * *Lifecycle transitions (`ROOM_SYNC`, `RECONNECT`):* Transmit full canonical `GameState` snapshot.

### 10.15 The client animation barrier pattern (`setGlobalCacheMessage`)

In `Checkerboard.js:235`, when a token begins moving, the client invokes:
```javascript
MessageCenter.setGlobalCacheMessage(true);
```
While `globalCacheMessage` is active, subsequent incoming network messages are queued in an internal
FIFO buffer. Once the 0.16 s hop sequence concludes and `MsgID_MoveChessEnd` fires, the queue is released:
```javascript
MessageCenter.setGlobalCacheMessage(false);
```

**Application for Ludo Base:**
In `BoardTokens.tsx`, rapid network intents or high-latency packets currently risk triggering a state
update while GSAP FLIP is mid-hop, causing visible position snapping or desynchronized highlight rings.
Implementing an explicit **Animation Barrier** in `useGameEngine.ts` / `BoardTokens.tsx` ensures:
1. `isAnimating` locks state mutation application during active 0.16 s hops.
2. Incoming room messages buffer cleanly without dropping frames.
3. The buffer flushes sequentially on animation completion.

### 10.16 Operational telemetry & connection state machine

Ludo World's `OFFLINE_REASON` enum (codes 3000–3005) categorizes transport dropouts and logs them via
`attrUpLoad`. To achieve parity in Ludo Base, we define a closed reason taxonomy in `lib/roomCodes.ts`
wired to Sentry and PostHog:

```typescript
export enum DisconnectReason {
  SOCKET_NULL = 'WS_IS_NULL',              // 3000: WebSocket failed instantiation
  NET_DOWN = 'NET_NOT_CONNECTED',          // 3001: Device offline / navigator.onLine false
  HEARTBEAT_TIMEOUT = 'HEARTBEAT_TIMEOUT',  // 3002: Ping unacknowledged > 60 s
  SERVER_CLOSED = 'SERVER_TERMINATED',      // 3003: Durable Object eviction / restart
  NETWORK_SWITCH = 'NETWORK_CHANGED',       // 3004: IP/interface change (WiFi -> Cellular)
  INTENT_TIMEOUT = 'INTENT_TIMEOUT'         // 3005: Room intent uncommitted > 10 s
}
```

Telemetry tracks `room_reconnect_attempt { reason: DisconnectReason, attempt: number, matchId: string }`,
giving ops immediate visibility into whether disconnect spikes stem from client network flakiness or DO
worker restarts.

---

## 11. Corrections to prior documents

| Claim in prior docs | Finding | Action |
| --- | --- | --- |
| Package `cct.com.tencent.ludosuperstar` (my first pass) | `com.tencent.ludosuperstar` — `cct` was an adjacent-string artefact | Fixed in `ANALYSIS.md` |
| `GAME_VERSION 2.2.8` read as app version | app is `2.1.10`; 2.2.8 is the game-logic version | Use 2.1.10 for the APK |
| "~106 `res/values-*` locales" | **No `res/values-*` exist**; `res/` is name-obfuscated. i18n is Cocos `LanguageData` | Re-verify before citing |
| "Their RNG is X" (implicit in places) | Tables live in remote bucket `1007` and are absent from the APK | Never cite a distribution |
| Classic `gridRoundLastNum = 76` treated as ring+6 | It equals `gridMaxNum`; Five/Six use ring+6. Their own inconsistency | Report both, resolve neither |
| Props are "5 hidden tiles" (ours) vs theirs | Theirs are 4 pre-roll modifiers, carry 3 | Not comparable 1:1 |

---

## 12. Limits of this analysis

- **No dynamic evidence.** No traffic was captured, so field-level semantics of `Reserve`,
  `S2C_HG_WRAPPER_MESSAGE`, and the TEA key schedule are unproven.
- **`modules/` is partial.** The config layer, state machines, and `LanguageData` live only in the
  minified `assets/main/index.js`. Findings that depend on them are marked [I].
- **One build.** 2.1.10 only; the `RoomCfg_1.6.7` bucket proves schema drift exists across versions.
- **REA could not complete on this target.** `analyze-javascript-application` fails with
  `cleanup_incomplete` on every scope (false-negative cleanup verification — the temp dir is created
  and left empty), and `analyze /bin/ls` returns `provider_unavailable` (no Hopper/Ghidra/IDA). All
  semantic work here was done by reading the source directly. See `ANALYSIS.md` §8.

---

## 13. Architectural Decision Records (ADRs for Ludo Base)

These records formalize the architectural adaptations derived from this teardown, mapping them
directly to Ludo Base's invariants in `AGENTS.md` and `ENGINE_LOGIC.md`.

### ADR-01: Server-authoritative match lifecycle via DO alarms

* **Status:** Proposed (P0)
* **Context:** `useGameTimer.ts` mints local turn deadlines (`Date.now() + 15s`), which desynchronize
  across tabs and latency spikes. `useAFKManager` lacks server authority, leading to orphaned seats.
* **Decision:**
  1. The Cloudflare Durable Object (`src/room/MatchRoom.ts`) owns `deadlineAt: epoch_ms` and schedules a
     native Cloudflare DO Alarm (`this.ctx.storage.setAlarm(deadlineAt)`).
  2. The client UI renders remaining time purely as `Math.max(0, deadlineAt - serverTime)`.
  3. When an alarm fires without a committed intent, the DO executes the default auto-play step and sets
     `seat.isTrust = true` (mirroring Ludo World's `TrustState`), broadcasting the transition.
* **Consequences:** Eliminates match-freeze bugs permanently. Fully preserves Edge RNG and atomic RPC
  commits (`match_commit_action`).

### ADR-02: Strict mode partitioning (Ranked DO vs. Offline Local)

* **Status:** Proposed (P0)
* **Context:** `useGameActions.ts` historically supported dual authority (P2P host fallback if WebSocket
  disconnected). This introduced race conditions, duplicate intent processing, and cheat exposure on
  ranked tables.
* **Decision:**
  1. **Ranked / On-Chain Matches:** 100% server authority via `MatchRoom` DO. If a player disconnects,
     the DO continues running the turn cycle with auto-play bot takeover. P2P is never an authority
     fallback for ranked play.
  2. **Offline / Pass-and-Play:** 100% local client execution via `lib/engine/core.ts` (zero network,
     zero CHIPS).
* **Consequences:** Eliminates complex NAT-hole-punching edge cases in ranked matches. Preserves
  invariants: derived winner authority verified against `match_states.state.winner`.

### ADR-03: Typed wire contract & rejection surface (`RoomError`)

* **Status:** Proposed (P0)
* **Context:** `RoomClient` currently collapses all failed intents into `new Error('[CODE] ...')` string
  templates, preventing the UI from branching cleanly on typed domain rejections like `POWER_ARMED` or
  `RATE_LIMITED`.
* **Decision:**
  Adopt a closed, typed rejection contract modeled after Ludo World's `ERRNO`:
  ```typescript
  export type RoomErrorCode =
    | 'ERR_PLAYER_NOT_ON_TURN'
    | 'ERR_PLAYER_HAS_ROLLED'
    | 'ERR_PLAYER_NOT_ROLLED'
    | 'ERR_INVALID_TOKEN_MOVE'
    | 'ERR_POWER_ALREADY_ARMED'
    | 'ERR_INTENT_RATE_LIMITED'
    | 'ERR_MATCH_ALREADY_CONCLUDED';

  export interface RoomErrorResponse {
    ok: false;
    code: RoomErrorCode;
    message: string;
    seq: number;
  }
  ```
* **Consequences:** Restores clean error boundaries in `useGameActions` without string-matching brittle
  error messages.

### ADR-04: Signed dynamic config registry (Edge KV)

* **Status:** Proposed (P1)
* **Context:** Pool fee caps, stake tiers, and timeout durations are hardcoded in `lib/constants.ts`,
  requiring production builds to adjust economic parameters.
* **Decision:**
  1. Adopt Ludo World's numbered bucket pattern (`ConfigsType`) via `GET /api/config.json`, cached in
     Cloudflare KV.
  2. Buckets: `1001: PoolTiers`, `1002: SettleWindows`, `1003: FeeCaps`, `1004: FeatureFlags`.
  3. All configuration blobs are signed with the platform admin key and verified by the client on boot,
     preventing CDN poisoning or tampering.
* **Consequences:** Eliminates hardcoded-tier drift while preserving on-chain validation of pool creation.

---

*Invariants this document must not be read as relaxing: `TEAM_PAIRINGS` single truth, engine-math
legality (`calculateNextPosition` / `getLegalTokenIndices`), Edge RNG receipts, pull-only CHIPS
claims. Nothing in Ludo World's design justifies weakening any of them.*
