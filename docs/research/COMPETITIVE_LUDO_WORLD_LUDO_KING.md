# Competitive Deep-Dive: Ludo World vs Ludo King vs Ludo Base

| Field | Value |
| --- | --- |
| **Project** | Ludo Base |
| **Document type** | Competitive research + build recommendations |
| **Subjects** | Ludo World (Tencent, `com.tencent.ludosuperstar` v2.1.10) · Ludo King (Gametion, `com.ludo.king` v10.1.0.388) · Ludo Base (this repo) |
| **Evidence roots** | `ludo-apkresearch/research/apk-analysis/ludo-world` · `ludo-apkresearch/research/apk-analysis/ludo-king` |
| **Companion plan** | `docs/tokenomics/CHIPS_PLANNING.md` (v4.3 — read in full for this report) |
| **Related docs** | `ENGINE_LOGIC.md` (rules spec) · `AGENTS.md` (security invariants) · `docs/gdd/GAME_DESIGN_DOCUMENT.md` · `docs/planning/RECOMMENDED_IMPLEMENTATION_PLAN.md` (engine/gaps first → stable build → then CHIPS/growth) |
| **Status** | Research baseline + gap/lessons synthesis (section section 10–13) |
| **Last updated** | 2026-09-22 |

---

## Table of contents

- [0. TL;DR](#0-tldr)
- [1. Method and scope](#1-method-and-scope)
- [2. Ludo World — technical profile](#2-ludo-world--technical-profile)
- [3. Ludo King — technical profile](#3-ludo-king--technical-profile)
- [4. Ludo Base (ours) — where we stand](#4-ludo-base-ours--where-we-stand)
- [5. Head-to-head comparison](#5-head-to-head-comparison)
- [6. Recommendations — what to take from each](#6-recommendations--what-to-take-from-each)
- [7. Tech shopping list](#7-tech-shopping-list)
- [8. Risks and non-goals](#8-risks-and-non-goals)
- [9. Suggested roadmap deltas](#9-suggested-roadmap-deltas)
- [10. Gap register — what we are lacking](#10-gap-register--what-we-are-lacking)
- [11. What we can add to improve](#11-what-we-can-add-to-improve)
- [12. Lessons for us](#12-lessons-for-us)
- [13. Recommendations — decision board](#13-recommendations--decision-board)

---

## 0. TL;DR

| | **Ludo World** (Tencent) | **Ludo King** (Gametion) | **Ludo Base** (ours) |
| --- | --- | --- | --- |
| Package / version | `com.tencent.ludosuperstar`, v2.1.10 (code 300007) | `com.ludo.king`, v10.1.0.388 | Web app (Next.js), no APK; Farcaster-ready |
| Engine | **Cocos Creator 2.4.15**, JSB (V8 + C++ GLES) | **Unity 6000.0.63f1**, IL2CPP | **Web**: React 19 + Next 16, GSAP/FLIP board animation |
| Game logic home | JS bundles in `assets/src/` (`cocos2d-jsb.js` 1.6M, `TSDK/tsdk.js` 1.3M / ~23k lines) | IL2CPP `global-metadata.dat` (15M); scenes `Loading` / `BootStrap.unity` | TS engine: `lib/gameLogic.ts` + `lib/engine/core.ts`, tested (`scripts/engine.test.ts`) |
| Multiplayer authority | Tencent IMSDK + custom TSDK WebSocket/TCP w/ heartbeat + reconnect; config at `ludoworld.ihappystudio.com` | Custom server over **Ktor + OkHttp/Cronet**; Play Games v2; Nearby + Bluetooth local play; **Agora voice** | Hybrid mesh: **host authority** + Supabase Realtime broadcast + PeerJS dual-path intents; **Edge `roll-dice` / `move-auth`** as RNG/move authority |
| Money | Google Play Billing 7.0.0 + **Tencent Midas/Centauri** pay; Meta Audience Network ads only | Billing 8.0.0 + **AppLovin MAX mediation + ~9 ad networks** | Planned: **CHIPS on B20**, `MatchPool` + `ClaimHub` pull-claims (Phase 1, not yet built — no `contracts/` in repo) |
| Identity / social | Facebook 12.2.0, Google Sign-In, Play Games, QQ/X5 webview, IMSDK login/auth | Facebook Unity SDK, Google Sign-In, Play Games v2 (`APP_ID \883097641214`) | SIWE app sessions + EIP-712 `LudoMatchSession`; ECDH P-256 DMs; Farcaster frames planned |
| Analytics / attribution | **AppsFlyer 6.10.1 + Adjust 4.17.0** + Firebase 21.2.2 + Dengta/Beacon + Bugly | Firebase (Analytics 23, Crashlytics + NDK, RemoteConfig, Sessions) — **no AppsFlyer/Adjust** | Planned: `chips_events` indexer + Builder Codes ERC-8021 attribution; crash/attribution SDKs absent |
| Anti-cheat | Release-hardened, multidex, `GetPublicKey` + `SafeLogin`, EagleEye | **ACTK + `com.pairip` packer/VM + SignatureCheck + RootUtil + Play `CHECK_LICENSE`** | Edge RNG receipts + dual-sign settle + scorer-on-rewards-only + RLS locks (strongest *design*, newest / most-unproven in prod) |
| Min / target SDK | 22 / 35 | 24 / 36 | n/a (web; Base Sepolia 84532 → Base 8453) |
| i18n | ~106 `values-*` locales | ~113 `values-*` locales | English-first; themes (`retro-futurism` / `daybreak`) but no locale pipeline yet |

**One-line take:** Ludo World is the *network-ops* reference (reconnect discipline, server-driven config, dual attribution). Ludo King is the *monetization + integrity* reference (MAX mediation, voice/local play, layered anti-tamper). Ours is the only *on-chain-settlement* design (visible pools, pull claims, memo-tagged burns) — but it currently lacks their crash/analytics/attribution plumbing, asset-delivery story, and decade of abuse-hardening. Engineering takeaways are in section 6; the full gap register, improvement backlog, lessons, and decision board are in section section 10–13.

---

## 1. Method and scope

- **Method:** static analysis of decompiled APK research trees (manifests, `apktool.yml`, native `lib/`, `assets/`, decompiled `sources/` and `smali*/` package listings, billing/analytics properties files). No dynamic instrumentation, no server traffic capture.
- **What this proves:** client engine, runtime, SDK inventory + versions, permissions, asset layout, advertised capabilities (voice, nearby, billing, push).
- **What this cannot prove:** server RNG fairness, matchmaking/ELO design, bot difficulty curves, exact dice distributions, live server protocols. Anything in that class is marked **inferred** or **not visible**.
- **Our side:** surveyed `package.json`, `AGENTS.md`, `ENGINE_LOGIC.md`, `hooks/`, `lib/`, `supabase/functions/`, `app/components/`, and `docs/tokenomics/CHIPS_PLANNING.md` in full (v4.3, Strix-audited baseline: single-currency CHIPS on B20, 10B cap / 2B liquid, pull-only claims, MatchPool + ClaimHub, Mode A/B settle liveness).

---

## 2. Ludo World — technical profile

Identity: `decompiled/AndroidManifest.xml:2` → `package=com.tencent.ludosuperstar`, `compileSdk 35`, `versionCode 300007 / versionName 2.1.10`; `decompiled/apktool.yml` → apktool 3.0.1, `minSdk 22 / targetSdk 35`; `engine.txt` = `cocos2d`; entry `org.cocos2dx.javascript.AppActivity` (portrait, `Theme.SplashTheme`), `lib_name=cocos2djs`.

### 2.1 Engine / runtime / rendering

- **Cocos Creator 2.4.15 (JSB):** `extracted/lib/arm64-v8a/libcocos2djs.so` (28M) embeds `F:/toos/Creator/2.4.15/...js-bindings`; `extracted/assets/src/cocos2d-jsb.js` (1.6M) + `src/jsb-adapter/{jsb-builtin,jsb-engine}.js`; `src/settings.js` → `launchScene: db://assets/scene/LoginApp.fire`, `jsList:[assets/Script/TSDK/tsdk.js]`, `server:""`, `remoteBundles:[]`; `assets/main.js: window.boot()` + `cc.assetManager.{INTERNAL,MAIN,RESOURCES}`; `assets/project.json: project_type:javascript`.
- Java wrapper: `source/sources/org/cocos2dx/javascript/AppActivity.java` extends `Cocos2dxActivity implements IJavaScriptEngine`; `org/cocos2dx/{lib,okhttp3,okio,javascript/{SDKWrapper,APMidasPayAPI,Analytics,BannerAd,RewardedAd,localpush,service}}`.
- Native: only `lib/{arm64-v8a,armeabi-v7a}/{libcocos2djs.so,libCrashSight.so (719K)}` — **no x86/x86_64**; V8 symbols confirm JS runtime + native crash capture.
- Smali split: `smali/`, `smali_classes2/`, `smali_classes3/` (multidex), top packages `MTT, android, androidx, com` / `com/{adjust,android,appsflyer,centauri,facebook,google}`.

### 2.2 Networking / multiplayer

- **No Photon / SmartFox / MQTT / WebRTC / socket.io / Firestore filenames** anywhere — authority is proprietary:
  - Tencent IMSDK: manifest `IMSDK_SERVER_{SDKAPI,NOTICE,HELP,CONFIG}=hk1-sdkapi.gameitop.com`, `GAME_ID=1314`, timeouts 30000; `com.tencent/imsdk/android/api/{gameservice,notice,help,webview}`; `IMSDKProxyActivity`.
  - Custom TSDK: `extracted/assets/src/assets/Script/TSDK/tsdk.js` (1.3M, ~23k lines) → 9× `WebSocket`, 29× `RECONNECT` / `HEARTBEAT` / `TCP`; endpoints `https://ludoworld.ihappystudio.com/unity/cgi/LudoUrlCfg.json`, CGI `https://{happy-ludo,ludo-cgi,login-ludo}.ihappystudio.com/cgi-bin/CommonMobileCGI/{Ludo_Support_Interface,GetPublicKey,Ludo_Happy_SafeLogin}` + legacy `cgi.huanle.qq.com/happyapp/...`.
  - HTTP: `com.centauri/http/*` (`CTIHttpRequest/Response`, interceptors) + bundled `com.squareup/*`, `org/cocos2dx/okhttp3/*`.
- **Lesson for us:** server-driven URL config (`LudoUrlCfg.json`) + explicit heartbeat/reconnect/TCP-fallback counters in the game script itself. Our dual-path intents (PeerJS + Supabase `GAME_INTENT` w/ shared `intentId`, host dedup via `processedIntentIds`) solve the same NAT-drop problem at the lobby layer — but we have **no in-match heartbeat/reconnect counters**; TSDK's 29 reconnect references are the benchmark (see section 6.1).

### 2.3 Monetization

- Play Billing **7.0.0** (manifest + `extracted/billing.properties`), `ProxyBillingActivity[V2]`, `BILLING` perm.
- **Tencent Midas/Centauri:** `assets/{MidasIAPSDKRescources.bundle, midas_oversea_hongkong, centauri_oversea_{hongkong,na,singapore}/centauri_oversea_cp.cfg}`, `com.centauri/oversea/business/pay`, `APMidasPayAPI.java`, `CTIProxyActivity`.
- Ads: **Meta Audience Network only** (`AudienceNetworkActivity/ContentProvider`, `assets/audience_network/classes{,2}.dex`) — no AdMob / Unity / AppLovin. Notably lean vs Ludo King.

### 2.4 Analytics / attribution / crash

- **Both** AppsFlyer **6.10.1** (`com/appsflyer/AFLogger.java`) **and** Adjust **4.17.0** (`com/adjust/sdk/BuildConfig.java VERSION_NAME`, token `hetzdrfojitc` in manifest) + Firebase Analytics **21.2.2** + Dengta/Beacon (`1RG46GOAQO21QD6K/1001`) + **Bugly** (`8f49fef698` / 2.1.10) + `MTT/*`, `com/uqm/crashsight+gcloud`, `com.tencent/{mid,mtt,smtt}`.
- **Lesson:** dual attribution (ad-network-grade AppsFlyer + product-grade Adjust) plus *three* crash/telemetry pipes. Our on-chain analogue is ERC-8021 Builder Codes (every CHIPS tx attributed) + `chips_events` — good, but we have **zero client crash reporting** today (see section 6.2).

### 2.5 Auth / social / push

- Facebook **12.2.0**, Google `SignInHubActivity`, `google-services.json: ludo-superstar-41f63`, Play Games `APP_ID`, IMSDK `api/{login,auth,account}`, QQ X5 TBS webview.
- Push: FCM (`FirebaseMessagingService`, `IMSDFirebasePushReceiver`, `IMSDK_PUSH_FCM_ENABLE`) + **local push** (`javascript/localpush/{AlarmReceiver,AlarmService,NotificationUtil}`); perms `POST_NOTIFICATIONS`, `C2D RECEIVE`, `AD_ID`, `BIND_GET_INSTALL_REFERRER`.

### 2.6 Permissions (~22, broad)

`INTERNET`, `ACCESS_{NETWORK,WIFI}_STATE`, `CHANGE_{NETWORK,WIFI}_STATE`, `READ_PHONE_STATE`, `READ/WRITE_EXTERNAL_STORAGE`, `WAKE_LOCK`, `VIBRATE`, `CAMERA`, `GET_TASKS` / `REORDER_TASKS` / `KILL_BG` / `RESTART_PACKAGES`, `READ_LOGS`, `MOUNT_UNMOUNT`, `DISABLE_KEYGUARD` / `WRITE_SETTINGS` — device-fingerprinting + storage-heavy posture we should **not** copy on web (it would alarm Base/Farcaster users).

### 2.7 Assets and i18n

- Fully bundled (`extractNativeLibs=true`, `server:""`); content-addressed Creator bundles `assets/assets/{internal,main,resources}/{config.json, import/{01..f8}/*.json, native/*.png}`; dynamic only via `LudoUrlCfg.json` / CGI; Creator template leftovers (`HelloWorld.png`).
- **~106 `res/values-*`** locales (zh-rCN/HK/TW, pt-rBR/PT, es-rES/US, en-rAU/CA/GB/IN, ko-rKR, fr-rCA…) — full localization pipeline (largely lib strings, but proof of global template).

---

## 3. Ludo King — technical profile

Identity: `AndroidManifest.xml` → `package=com.ludo.king`, `compileSdk 36`, `minSdk 24 / targetSdk 36`, `installLocation=auto`, `base__abi` splits; app `com.pairip.application.Application`; main `com.unity3d.player.FoldablePlayerActivity` (singleTask, portrait, maxAspect 2.4, `unityplayer.UnityActivity=true`).

### 3.1 Engine / scripting

- **Unity `6000.0.63f1`** (`meta com.google.unity.ads.UNITY_VERSION` + `globalgamemanagers` strings; scenes `Assets/GameData/_scenes/{Loading,BootStrap}.unity`).
- `decompiled/assets/bin/Data/`: `globalgamemanagers[.assets]`, `level0.split0-3`, `sharedassets0.assets.split0-42`, `boot.config (build-guid=e0617033...)`, `ScriptingAssemblies.json` (incl. `MultiplayerModule`), `RuntimeInitializeOnLoads.json`, `Managed/Metadata/global-metadata.dat` (15M), no loose `Managed/*.dll` → **IL2CPP**.
- **No `lib/<abi>/*.so` in this dump** (`find -name *.so` = 0) — consistent with the `base__abi` split APK (native `libunity` / `libil2cpp` live in the missing ABI split). GLES 3.0 required (`glEsVersion 0x30000`); Vulkan optional.
- `engine.txt` says `custom` — mislabeled; manifest + Data layout prove Unity.

### 3.2 Multiplayer / networking (+ voice / local)

- **No Photon / PUN / PlayFab / socket.io** in sources — custom stack: **`io/ktor/{client,websocket,http,network,serialization}`** + `okhttp3` + `play-services-cronet 18.0.1`.
- **Voice:** `io/agora/{rtc,gaming}` + perms `RECORD_AUDIO + BLUETOOTH(+CONNECT) + MODIFY_AUDIO_SETTINGS` — in-game voice chat confirmed by SDK + permission combo.
- **Local play:** `play-services-nearby 18.0.2` + `android.hardware.bluetooth` feature → pass-and-play / nearby sessions.
- Platform: `play-services-games-v2 17.0.0`, `APP_ID \883097641214`, `NativeBridge` / `GenericResolution` / `GamesResolutionActivity`; deep link `http(s)://lk.gggred.com` (autoVerify) on the Unity activity.

### 3.3 Monetization — the reference implementation

- IAP: billing **8.0.0**, `ProxyBillingActivity[V2]`, `BILLING + CHECK_LICENSE + BIND_GET_INSTALL_REFERRER`; PAD **2.3.0** (asset packs), 8 dex files.
- Mediation hub **AppLovin MAX** (`AppLovinInitProvider:101`, `FullscreenAdService`, 15 `MaxDebugger*` activities, `com/gametion/applovinfix`) fronting **~9 networks**: GMA **24.9.0** (`ca-app-pub-6685996456292814~9090983008`), UnityAds (+ `com.unity3d.ironsourceads`), ironSource/LevelPlay, Meta AN, Mintegral/MBridge, InMobi, Vungle/Liftoff (`VungleProvider:102`), Fyber/DT (+ Ignite), Moloco xenoss, **Crackle RTB** (`crackle_key: fai=1:8756…fpi=gametion---ludo-king`).
- Measurement/consent: OMID (`omsdk-v1_5_2.js`), **UMP 3.2.0**, AdServices (AD_ID / ATTRIBUTION / TOPICS / CUSTOM_AUDIENCE), ~30 obfuscated `assets/{hash}` ad payloads.

### 3.4 Analytics / auth / push

- Firebase: Analytics/Measurement **23.0.0**, Crashlytics (+NDK/KTX), RemoteConfig **20.0.4**, Sessions, ABT, IID, Installations, datatransport/cct. **No AppsFlyer/Adjust/Branch/Singular** — first-party + ad-SDK attribution only.
- Social: Facebook Unity (`FBUnityLogin/Dialogs/AppLink/DeepLinking/GameRequest`, `ApplicationId fb321549981551150`, AutoLogAppEvents) + Google Sign-In.
- Push: FCM full set + `UnityNotificationManager` + WorkManager + `dexopt/baseline.prof`.

### 3.5 Anti-cheat / integrity — strongest client of the three

- `net.codestage.actk.androidnative` (**CodeStage Anti-Cheat Toolkit**): async `JarFile(publicSourceDir)` SHA `CodeHashGenerator` + `FileFilter` / `CodeHashCallback`, `NativeUtils.GetApkPath()`.
- `com.pairip` packer: `StartupLauncher.launch()`, `VMRunner` / `VmDecryptor`, **`SignatureCheck` SHA-256 allowlist** (`7Vc9sxw6…`, `Vn3kj4pU…`, throws `SignatureTamperedException`).
- `com.gametion/rootsecurity/RootUtil` (test-keys / su / Magisk / Superuser.apk checks), `cleardatalib/ClearDataNative`.
- ~113 `values-*` locales.

---

## 4. Ludo Base (ours) — where we stand

Stack (`package.json`): **Next.js 16.1.6 App Router + React 19.2.4 + Tailwind 4.2.1** (`app/page.tsx` lobby↔board↔spectate); 54 files in `app/components/` (`Board.tsx`, `BoardTokens.tsx`, `ChessTokens.tsx`, `LudoDice.tsx`, `GameLobby.tsx`); chain `wagmi 2.19.5 + viem 2.56.8 + onchainkit 1.1.2 + farcaster frame/miniapp SDKs` (`app/Providers.tsx`: `base` + `baseSepolia`); backend `supabase-js 2.98` (`lib/supabase.ts`), 7 migrations, Deno Edge Functions `roll-dice` / `move-auth` / `resolve-bet` + `_shared/{engine,networkBoundary,walletVerify}`; realtime **PeerJS 1.5.5** + Supabase Realtime `game-room-<roomCode>`; anim `gsap 3.15` (GSAP-only FLIP 1.3s hops) + framer-motion + canvas-confetti; audio only in `app/hooks/useAudio.ts`, `useSoundEffects.ts`.

Engine (pure, tested): `lib/gameLogic.ts` + `lib/engine/core.ts` — `calculateNextPosition` / `getLegalTokenIndices` mandatory (never `pos+roll`), capture-Force, 3×six skip, exact-finish 57, home-lane 52–57; `lib/boardLayout.ts` 15×15 path 0–51 + corners / safe-stars; `lib/constants.ts` — `TEAM_PAIRINGS` Green+Blue vs Red+Yellow (single truth), `AI_SCORES`, `DIFFICULTY_PARAMS`; bots Rookie/Pro/Master (`lib/aiEngine.ts`); modes Classic + Power v3 (5 hidden tiles, timed inventory); spec `ENGINE_LOGIC.md`.

Multiplayer (hybrid mesh, host authority): host/compute-host executes, guests send intents; **dual-path intents** (PeerJS `GAME_ACTION` + Supabase `GAME_INTENT`, shared `intentId`, `processedIntentIds` dedup) and **dual-path seating** (`JOIN_REQUEST` retried + REST poll + PeerJS `SYNC_PROFILE`; room-secret `?s=` / matchmaking `validation_token` gates); Edge RNG receipts (`match_rolls`, unique `action_id`), commit-reveal legacy (`useProvablyFairDice.ts`), listen-only spectate (`useSpectatorSync.ts`), `match_states.seq` as display+rules authority. Trust invariants in `AGENTS.md` (EIP-712 `LudoMatchSession` per match, SIWE for chat/profile only, `/api/match/record` + `resolve-bet` host-signed, power-`type` stripped via `wireSanitize.ts`, ECDH DMs fail-closed, messages UPDATE column-locked).

CHIPS plan (v4.3 Strix-audited, **planned — not implemented**): **Chips/CHIPS, B20 Asset, 18 dec, 10B cap / 2B liquid** (30/20/20/20/10), Base Sepolia now → Base mainnet later; single currency, 100% pull-claims, visible `MatchPool` (seat-allowlisted, Edge lobby-ticket-bound, fee-tier allowlist, `hostBond`, Mode A dual-sign + Mode B Edge-fallback settle, `settleBy + pauseDelta + refundGrace`, dispute `claimUnlockAt` 2/5/10 min) + `ClaimHub` router + `MissionClaim` vouchers + `SeasonClaim` merkle + `SupplyLocker` quarterly-500M / monthly-drip gated unlocks + memo-tagged burns (`match:burn` etc.) + ERC-8021 Builder Codes on every tx + UUPS upgrade matrix + 8130/8168 session/gas path. Repo status: **no `contracts/` / sol**, UI slots only (`MatchStatsOverlay` "Claim wiring soon", mock `MarketplacePanel`), but chain-gating (`lib/chains.ts` 84532/8453), builder-code wiring (`lib/builderCode.ts`), and dual-chain auth tests already done. Full detail: `docs/tokenomics/CHIPS_PLANNING.md` section section 4–8, 8.10 matrix, Phase 0–4 roadmap, KPIs.

---

## 5. Head-to-head comparison

| Concern | Ludo World | Ludo King | Ludo Base + CHIPS plan |
| --- | --- | --- | --- |
| Rendering | Cocos GLES, content-addressed bundles, tiny wrapper | Unity IL2CPP, GLES3, PAD splits | Web GSAP FLIP (smooth, no native) — weakest on low-end mobile |
| Netcode resilience | TSDK heartbeat/reconnect/TCP counters (best) | Ktor websockets + Cronet | Dual-path intents (good) but no in-match heartbeat ladder yet |
| RNG fairness | Server CGI + SafeLogin (opaque) | Server-authoritative (opaque) + Play Games | **Edge `roll-dice` receipts + `match_rolls`** (most auditable) |
| Settlement | Server-side, invisible | Server-side, invisible | **Visible on-chain pool + dual-sign / Edge-fallback + dispute window** (novel; unproven at scale) |
| Monetization breadth | Midas + IAP + 1 ad net | **IAP + MAX + 9 nets** (best) | CHIPS pools/fees/burns + marketplace (designed, unbuilt) |
| Retention mechanics | IMSDK notice/help/gameservice ops | Quests/achievements via Play Games, voice, local play | RXP + seasons + missions + referral/onboarding 1K package (designed) |
| Integrity | Pubkey login, EagleEye | **ACTK + packer/VM + sig-check + root + license** (best client) | Edge attest + scorer-rewards-only + RLS (best server design) |
| Analytics | Dual attribution + 3 crash pipes (best) | Firebase full suite | Indexer plan only — gap |
| i18n | 106 locales | 113 locales | None yet — gap |

Full gap inventory: [section 10](#10-gap-register--what-we-are-lacking). Improvement backlog: [section 11](#11-what-we-can-add-to-improve). Decision board: [section 13](#13-recommendations--decision-board).

---

## 6. Recommendations — what to take from each

Prioritized P0 → P3. Every item preserves the `AGENTS.md` invariants (single `TEAM_PAIRINGS` truth, engine-math legality, Edge RNG authority, pull-only claims). For the consolidated gap register, improvement bands, and product decision board, see [section section 10–13](#10-gap-register--what-we-are-lacking).

### P0 — close structural gaps before Phase-1 value

1. **Heartbeat + reconnect ladder in-match** (from World's TSDK). Our dual-path covers lobby/intents; add seq-gap detection + heartbeat + explicit reconnect/backoff counters to `hooks/useSupabaseRelay.ts` / `hooks/usePeerManager.ts`, and surface them in the Edge co-sign retry-queue alerts (`CHIPS_PLANNING.md` section 8.6: <15s target, >60s page). Name the counters like TSDK does so ops can graph them.
2. **Crash + client telemetry now** (both competitors ship it; we ship none). Add Sentry (or equivalent) + Web-Vitals + GSAP-animation jank metrics before Sepolia playtests — otherwise Phase-1 KPIs (settle p95, indexer lag) have no client-side counterpart.
3. **Server-driven config endpoint** (World's `LudoUrlCfg.json` pattern). We already mint Edge lobby tickets; publish a signed `config.json` (pool tiers, fee caps, `settleBy` / `refundGrace` / `disputeWindow` per tier, RPC list, activation flag) that clients fetch before join — while keeping everything enforced on-chain (section 4.2b chain-read rule). Kills hardcoded-tier drift.
4. **B20 + ERC-8021 trailing-suffix Foundry assertion** (section 8.7 M11) is the single highest-risk unknown in the whole plan (precompile may reject trailing calldata). Prove it on `base-anvil` before writing any join/claim UI — if it fails, attribution falls back to `transferWithMemo` / wrapper hops per the plan.

### P1 — monetization and economy (King is the teacher)

5. **Free-tier ad stack design (not build).** King's MAX + 9-network setup is why free play pays. Our plan correctly keeps free tables off-chain; reserve a `FreeAdSurface` slot in the economy (rewarded ads → RXP / mission-progress, never CHIPS directly) so S1's 4–7% burn/emission gap (section 5.3) has a non-token revenue leg. Keep the seam, don't integrate yet.
6. **Cosmetics price-band discipline.** Plan section 7.4 already re-prices legacy 1–20 CHIPS items to 50–50,000 bands so cosmetics compete with the 1,000 Standard stake. King's limited-window legendary cadence is the content model to copy; our `Marketplace` burn split (5% protocol + 1% burn) mirrors their take-rate logic on-chain.
7. **Gas-negative tier guard is correct — keep it.** Both competitors can afford ₹1-equivalent stakes because settlement is a DB row. Ours costs L2 gas per approve/join/settle/claim, so the plan's mainnet 100-CHIPS exclusion (chain-scoped allowlist M10 + lobby hide <1,000 CHIPS) is the right call; fund the ERC-8168 gas-only paymaster (section 8.9) before revisiting.

### P1 — retention and social (both competitors prove it)

8. **Voice + emotes.** King's Agora voice is a retention pillar in long 4P games. Cheapest web equivalent: push-to-talk via LiveKit/WebRTC post-Phase-1; short-term, expand emotes / preset-chat (already themed) since DMs are ECDH-sealed and safe.
9. **Local / pass-and-play + Nearby analogue.** King keeps Nearby/Bluetooth; World keeps offline template assets. We have offline/AI (off-chain, no CHIPS — section 3.2) — add QR / share-link *local* rooms (`?s=` already exists) as the web analogue, plus a real **web-push** layer (VAPID/FCM) mirroring their `AlarmReceiver` / `UnityNotificationManager` for turn-nudges and claim reminders (claim-rate 40–70% KPI in section 11 depends on this).
10. **Seasons + quests cadence.** King's Play-Games achievements and World's gameservice/notice ops map directly onto our RXP tiers → S1 ladder (Bronze 500 → Arena Master 50k, section 7.3) + Galxe OAT tracks (section 7.7). Keep gameplay rewards first / social last (anti-lockout rule) — Galxe outages must never block earnings, per plan.

### P2 — integrity (take King's client layers, keep our server design)

11. **Web-integrity equivalents of ACTK / packer / sig-check:** CSP + Subresource Integrity + Trusted Types, build-hash attestation on Edge (`ticketHash` already binds lobby; extend to client-build hash), Play Integrity only if/when we wrap in a native shell. Never rely on client checks for money — they stay *abuse-signal*, with settle staying dual-sign / Edge-fallback (HIGH-1) and abandon-burn staying dual-only (HIGH-2).
12. **Anti-farm specifics already in plan — enforce on-chain, not UI:** distinct-opponent minimums, paid-volume floor for mission CHIPS, scorer on mission/season/partner only (never match prizes/refunds), per-wallet daily/weekly caps + hard epoch stops (section section 4.8/5.3/7.2). King's root-checking and World's device-permission fingerprinting are reminders that farming is industrial — the Sybil-profitability model is a Phase-0 freeze gate for a reason.
13. **Dispute-window watcher runbook** (section 12) has no competitor equivalent — it's our novel surface. Staff it: automated watchers during 2/5/10-min windows, timeout-refund triggers on *effective* `settleBy + pauseDelta`, ε-breach freeze of vouchers / pool-creation.

### P3 — platform and distribution

14. **Deep links + frames.** King's `lk.gggred.com` autoVerify ↔ our `?s=` invite links + Farcaster frames (Phase 3 relay with signed join-intent binding so frame relays can't swap calldata). Same growth mechanic, ours inherits wallet attribution.
15. **Consent + age/geo posture.** King's UMP 3.2.0 + AdServices vs our sender/executor-scope policy + pre-freeze legal issue-spot (section 9/H7). Predict pools need their *own* sportsbook sign-off — never inherit the match-pool analysis (section 4.10). Schedule the legal opinion before Phase-1 build, not Phase 4.
16. **Delivery.** King's PAD + ABI splits and World's content-addressed bundles → our equivalents: Next route-splitting + lazy board chunks + pinned IPFS merkle leaves + `TOKEN_PARAMS.md` per-env salts/addresses. Record `isActivated(ASSET)` before deploy (Phase-0 gate 5).

---

## 7. Tech shopping list

| Observed | Version | Our action |
| --- | --- | --- |
| Cocos Creator (World) | 2.4.15 JSB | No action (web stack stays); adopt bundle-addressing hygiene for board assets |
| Unity (King) | 6000.0.63f1 IL2CPP | No action; note GLES3 baseline for any future native shell |
| Play Billing | 7.0.0 (World) / 8.0.0 (King) | Reference only — CHIPS replaces IAP for value; keep for any future wrapped-shell consumables |
| AppLovin MAX + GMA 24.9.0, UMP 3.2.0, OMID | King | Phase-2+ free-tier ads; keep seam, don't integrate now |
| Agora RTC/Gaming | King | Post-Phase-1 voice spike (LiveKit alt) |
| Ktor websockets + Cronet 18.0.1 | King | Already covered by Supabase Realtime + PeerJS; add heartbeat ladder (section 6.1) |
| AppsFlyer 6.10.1 + Adjust 4.17.0 + Bugly + Dengta | World | Add Sentry + product analytics now; attribution = Builder Codes + `chips_events` |
| Firebase Analytics 21–23, Crashlytics + NDK, RemoteConfig, Sessions | both | Web: crash + RemoteConfig-equivalent (Edge config) + session replay for playtests |
| ACTK + pairip VM + sig-check + RootUtil | King | Web-integrity set (section 6.11); money stays server/chain-authorized |
| TSDK reconnect / heartbeat / TCP | World | In-match resilience counters (section 6.1) |

---

## 8. Risks and non-goals

- Static analysis can't see server fairness, matchmaking ELO, bot difficulty curves, or exact dice distributions — don't cite this report for "their RNG is X".
- King's `.so` / ABI split and World's `server:""` mean native and remote-dynamic behavior are only partially observed — flagged inline in section section 2–3.
- We intentionally do **not** recommend copying World's broad device permissions, any opaque server-settle trust, or King's 9-network ad weight on day one — our edge is auditable settlement, and every recommendation above preserves it.

---

## 9. Suggested roadmap deltas

Additive only — no `CHIPS_PLANNING.md` rewrite:

- **Phase 0:** add "client telemetry live" + "signed config endpoint" to freeze gates; keep all 11 existing gates.
- **Phase 1:** add heartbeat/reconnect counters + web-push turn/claim nudges + Sentry to the exit demo (alongside visible-pool → dual-sign settle → pull-claim + memo burn + Builder-Code verification + `MINT_ROLE == ∅`).
- **Phase 2:** spectator predict stays gated on join-policy + sportsbook sign-off (unchanged); add rewarded-ads seam + voice spike as non-blocking tracks.
- **Phase 3/4:** frames + paymaster + audit path unchanged.

---

## 10. Gap register — what we are lacking

An explicit inventory of missing capabilities versus Ludo World + Ludo King, scored by what actually blocks Phase-1 value and player trust. Severity: **B**locks money/reputation · **G**rowth-limited · **P**olish. Status is repo state as of this revision (no `contracts/`, no client crash SDK, English-first UI).

### 10.1 Observability and ops (sev: B)

| Gap | Competitor evidence | Us today | Why it hurts |
| --- | --- | --- | --- |
| Client crash reporting | World: Bugly + CrashSight + Dengta. King: Crashlytics + NDK | None | Sepolia playtests die silently; settle p95 / claim-rate KPIs have no client counterpart |
| Product analytics + session funnel | World: AppsFlyer + Adjust + Firebase. King: Firebase full suite | No client analytics; `chips_events` only planned | Cannot tell drop-off at wallet connect → approve → join → claim |
| Web-vitals / animation jank | (implicit in native profilers) | GSAP 1.3s hops with no jank budget | Low-end mobile is our weakest render path (section 5) |
| Remote config / kill-switch | World: `LudoUrlCfg.json`. King: RemoteConfig | Hardcoded tiers + local env | Cannot hot-disable a bad pool tier or RPC without a deploy |
| In-match ops counters (heartbeat / reconnect / seq-gap) | World TSDK: 29× reconnect/heartbeat/TCP refs | Lobby dual-path + `match_states` refresh exists; **no named ops ladder** | NAT flaps look like "game froze" instead of graphable SLOs (section 6.1) |
| Broken lint gate | n/a | `npm run lint` is broken (Next 16 removed `next lint`) | Typecheck + engine tests only — style/regression floor is thinner than CI implies |

### 10.2 Live ops and retention (sev: G)

| Gap | Competitor evidence | Us today | Why it hurts |
| --- | --- | --- | --- |
| Quests / achievements / battle-pass cadence | King: Play Games achievements. World: IMSDK notice/help/gameservice | RXP + seasons + missions **designed** (`CHIPS_PLANNING` section 7), not shipped | No daily return reason outside "play a match" |
| In-game notice / announcement surface | World: IMSDK notice + help | No live-ops bulletin channel in product | Season drops, dispute freezes, unlock windows have nowhere to speak |
| Limited-window cosmetics cadence | King: legendary limited drops | Marketplace is a mock panel | Burn/emission story has no content engine |
| Tournaments / cups | Both run seasonal ops | Designed only | Creator/guild distribution (Partners 10%) has no stage |

### 10.3 Social and session quality (sev: G)

| Gap | Competitor evidence | Us today | Why it hurts |
| --- | --- | --- | --- |
| Voice | King: Agora RTC/Gaming | None | Long 4P sessions feel lonelier than King; watch party / Arena is weaker |
| Rich presence / emotes | Both ship social layers | Themed preset chat + ECDH DMs only | Expressive play is our thinnest surface |
| Local / Nearby play | King: Nearby + Bluetooth. World: offline template assets | Offline vs AI exists; no co-located shared-device mode | Party / café use-case (King's real-world hook) is missing |
| Turn / claim push | King: FCM + UnityNotificationManager. World: localpush AlarmService | No web-push / VAPID | Claim-rate KPI (40–70% in `CHIPS_PLANNING` section 11) will miss without nudges |
| Spectator → predict / coach | (emerging in casual live) | Listen-only `useSpectatorSync.ts`; predict gated | Arena narrative stops at "watch" |

### 10.4 Distribution and platform (sev: G)

| Gap | Competitor evidence | Us today | Why it hurts |
| --- | --- | --- | --- |
| i18n | 106–113 `values-*` locales each | English-first; 2 themes, 0 locale pipeline | Excludes the LATAM / SEA / MENA volume both competitors own |
| App-store presence | Play Store + decade of ASO | Web + Farcaster frames planned | Discovery cost stays on wallets/social; no organic install shelf |
| Deep-link surface | King: `lk.gggred.com` autoVerify | `?s=` invite links only | Share → install → seat conversion has no owned domain/ASO path |
| Consent / age / geo story | King: UMP 3.2.0 + AdServices | Policy notes + pre-freeze legal spot (planned) | Paid pools need eligibility **before** mainnet value (B20 policy registry) |

### 10.5 Economy and settlement buildout (sev: B)

| Gap | Competitor evidence | Us today | Why it hurts |
| --- | --- | --- | --- |
| Settlement contracts | Both have opaque server settle (weakness we exploit) | **No `contracts/` at all** — UI slots only | Entire CHIPS thesis is unproven in code |
| Claim UX | Server wallets "just work" | `MatchStatsOverlay` "Claim wiring soon" | Pull-claims design without claim UI is a narrative, not a product |
| Marketplace / cosmetics | King: IAP + MAX content | Mock `MarketplacePanel` | Burn sink (`match:burn` / `market:burn`) has no primary surface |
| Attribution completeness | World dual MMP | `lib/builderCode.ts` wired; not end-to-end proven on B20 | Silent revenue loss if ERC-8021 suffix is dropped (plan section 8.7) |
| Gas / paymaster path | n/a (server settle is free to user) | ERC-8168 paymaster planned | Low stakes die to gas friction (section 6.7 guard is correct but incomplete) |

### 10.6 Client integrity and abuse (sev: B once value ships)

| Gap | Competitor evidence | Us today | Why it hurts |
| --- | --- | --- | --- |
| Build / bundle integrity | King: ACTK + pairip VM + SignatureCheck | No SRI / Trusted Types / build-hash pin on Edge tickets | Modded clients become viable the moment CHIPS is real |
| Industrial farm defenses | King root/Magisk checks; World device perms | Sybil model **planned as Phase-0 gate**; caps designed, not enforced on-chain | Farm bots are the default attack on any claim faucet |
| Dispute-window staffing | (nobody has this — our novel surface) | Runbook in plan section 12, unstaffed | 2/5/10-min windows become a liability if nobody watches |
| Abandon / AFK honesty | Both have invisible server abandon logic | Dual-sign abandon designed (HIGH-2); grace window not live | Ranked pots leak to rage-quit without it |

---

## 11. What we can add to improve

Backlog grouped by delivery band. Every row preserves `AGENTS.md` invariants. "Differentiator" marks what neither competitor can copy without abandoning their server-settle model.

### 11.1 Ship before any Sepolia value (Phase 0 freeze gates)

| # | Add | Why | Differentiator? |
| --- | --- | --- | --- |
| A1 | Sentry (or equiv) + Web-Vitals + a `telemetry` beacon on board/room transitions | Closes section 10.1; makes playtest data real | No |
| A2 | Signed Edge `config.json` (pool tiers, fee caps, `settleBy` / `refundGrace`, RPC list, feature flags) | World's `LudoUrlCfg` pattern; kills hardcoded drift (section 6.3) | No |
| A3 | Heartbeat / reconnect / seq-gap **named counters** + match-connection SLO board | World TSDK benchmark (section 6.1); feeds co-sign retry alerts | No |
| A4 | B20 + ERC-8021 trailing-suffix Foundry assertion on `base-anvil` | Highest-risk unknown in the whole plan (section 6.4) | Yes (Base-native) |
| A5 | Fix or replace `npm run lint` (ESLint via `eslint`/`next` config or Biome) and put it in CI | Hygiene; stop pretending CI covers style | No |
| A6 | Sybil-profitability model **frozen** and cited in TOKEN_PARAMS | Farming is industrial (Lesson L8) | No |
| A7 | Legal issue-spot + eligibility policy schema for paid pools (geo/age) | B20 policy registry must exist before mainnet value | No |

### 11.2 Phase 1 — playable economy (value-adjacent)

| # | Add | Why | Differentiator? |
| --- | --- | --- | --- |
| B1 | ClaimHub claim UI + tx status + "claim later" hub tab | Pull-only claims are our trust story — they must be one-tap honest | Yes (visible pool) |
| B2 | Web-push (VAPID) turn nudges + claim reminders | Claim-rate KPI depends on this (section 6.9) | No |
| B3 | Match receipt page: rolls (`match_rolls`), settle sigs, pool address, memo burns | **Trust artifacts competitors cannot show** — the product marketing is the explorer link | **Yes** |
| B4 | Dual-path abandon grace + AFK strike counter visible to seats | HIGH-2 economics without it are wrong | Yes (on-chain memo) |
| B5 | Live-ops notice strip (server-driven, signed) for freeze / unlock / season | World IMSDK notice analogue; required when money can pause | No |
| B6 | Quest/mission skeleton wired to `MissionClaim` vouchers (gameplay first, social last) | Retention spine of `CHIPS_PLANNING` section 7 | Partial (on-chain claim) |
| B7 | Emotes + expanded preset-chat | Cheap retention until voice | No |
| B8 | QR / share-link **local room** pass-and-play on one device | King Nearby analogue on web (section 6.9) | No |

### 11.3 Phase 2+ — growth and session depth

**Status note (2026-09-22):** Voice, i18n, and ads are **parked until after a stable build** — see `docs/planning/RECOMMENDED_IMPLEMENTATION_PLAN.md` section 8. Do not staff C1/C2/C4 until the stable-build gate is green and those tracks are explicitly un-parked.

| # | Add | Why | Differentiator? | Status |
| --- | --- | --- | --- | --- |
| C1 | Push-to-talk voice spike (LiveKit or similar) | King's Agora lesson (section 6.8) | No | **Parked** — after stable build |
| C2 | i18n pipeline (`next-intl` or equivalent) + 4 priority locales first (es, pt-BR, hi/id, ar) | Match competitor geo volume without 110-locale vanity | No | **Parked** — after stable build |
| C3 | Spectator predict pools **only after** join-policy + sportsbook sign-off | Already gated; don't shortcut | Yes (on-chain predict) | Gated (CHIPS Phase 2) |
| C4 | Rewarded-ads seam → RXP / mission progress (never CHIPS direct) | King MAX lesson without day-one ad weight (section 6.5) | No | **Parked** — after stable build |
| C5 | Limited-window cosmetics drops with published burn split | King content cadence + our on-chain sink | Partial | After CHIPS value track |
| C6 | Farcaster frames with signed join-intent binding | Growth loop with wallet attribution (section 6.14) | **Yes** | After stable + CHIPS |
| C7 | Native shell (Capacitor/TWA) + Play Integrity **only if** store distribution becomes a goal | Don't inherit King's permission posture on web | No | Out of current plan |
| C8 | Build-hash pin + CSP/SRI/Trusted Types + Edge ticket binding to client build | Web-integrity set (section 6.11) | No | With Track Q/N hardening |

### 11.4 Explicitly *do not* add (non-goals that look like gaps)

- Device-permission fingerprinting (`READ_PHONE_STATE`, `READ_LOGS`, `GET_TASKS`, …) — World's posture would alarm Base/Farcaster users and still not secure money.
- Opaque server settlement "because it's easier" — that is the competitor weakness we exist to fix.
- Soft/hard dual currency or push payouts — already rejected in `CHIPS_PLANNING` section 0/section 13.
- 9-ad-network MAX stack on day one — keep the seam (C4), don't ship the weight.
- Scoring match prizes in the mission scorer — farm surface (plan section 4.8).

---

## 12. Lessons for us

Condensed principles the two APKs teach. Inline "Lesson for us" notes in section section 2–3 remain the evidence trail; this section is the rulebook.

| # | Lesson | Evidence | Rule for Ludo Base |
| --- | --- | --- | --- |
| **L1** | **Netcode ops are a product feature, not plumbing.** | World's TSDK embeds heartbeat, reconnect, TCP-fallback counters *in the game script* (29 refs) | Name and graph our reconnect ladder like TSDK; expose connection state in-match UX (not only console). Dual-path intents fix *delivery* — they do not fix *observability*. |
| **L2** | **Server-driven config beats deploys for live risk.** | World `LudoUrlCfg.json`; King RemoteConfig | Any tier, fee cap, RPC, or kill-switch that ops must change under fire goes in signed Edge config (A2), still enforced on-chain. |
| **L3** | **Monetization is a *system*, not a banner.** | King: MAX + 9 nets + UMP + OMID + IAP + PAD | Design the free-tier revenue leg (ads → RXP) *as architecture* now even if we integrate late. Free play must not dilute CHIPS (never ads → CHIPS). |
| **L4** | **Retention is social + live-ops density.** | King voice/Nearby/achievements; World notice/help/gameservice | Board skins don't return players; voice, quests, and a notice channel do. Ship the notice strip (B5) before marketing seasons. |
| **L5** | **Localization is table stakes for casual scale.** | 106 / 113 locale trees | Don't aim for 110 locales; aim for a real pipeline and 4–8 high-ROI locales before paid UA. |
| **L6** | **Crash/telemetry is mandatory when money moves.** | World ships *three* crash pipes; King NDK Crashlytics | No Sepolia CHIPS playtest without Sentry + Web-Vitals + funnel events (A1). "It felt fine" is not a KPI. |
| **L7** | **Client anti-cheat is layered, continuous, and still not enough.** | King: ACTK + packer/VM + SignatureCheck + RootUtil + license | Treat all client checks as **abuse signal only**. Money stays on Edge attest + dual-sign settle + pull-claims (AGENTS.md invariants). Ship C8 as hygiene, not as trust. |
| **L8** | **Farming is industrial the moment value exists.** | King root/Magisk; World device fingerprinting | Freeze the Sybil-profitability model in Phase 0 (A6). Enforce distinct-opponent floors, volume floors, epoch caps **on-chain**, never in UI. |
| **L9** | **Gas changes the product floor.** | Competitors settle at ₹1-equivalent because DB rows are free | Keep the gas-negative tier exclusion (section 6.7). Fund ERC-8168 paymaster before arguing for low stakes. UX copy should say "min stake" not "gas". |
| **L10** | **Don't copy their trust model — exploit it.** | Both settle invisibly server-side | Our marketing and design center is **visible pool + receipt + pull claim** (B3). If a feature would hide settlement, it is a regression even if it converts better this week. |
| **L11** | **Permissions are brand.** | World's ~22-perm device-fingerprint posture | Web/Farcaster users will bounce on scary prompts. Prefer wallet + session + Edge tickets over device identity. |
| **L12** | **Attribution needs two layers when you care about unit economics.** | World ships AppsFlyer *and* Adjust | On-chain Builder Codes cover CHIPS txs; still add a product analytics funnel (A1) for off-chain steps (lobby, invite open, reconnect). Silent drop-off is silent loss. |
| **L13** | **Novel surfaces need runbooks or they become liabilities.** | Neither competitor has a public dispute window | Dispute windows, pauseDelta, and refundGrace are only as good as the watcher (plan section 12). Staff them before mainnet, not after the first incident. |
| **L14** | **CI that lies is worse than no CI.** | (ours) `npm run lint` broken while CI is green on typecheck/engine | Fix the gate (A5). Engineering trust in the pipeline is part of player trust in the chain. |

---

## 13. Recommendations — decision board

section 6 remains the engineering shopping list. This is the **priority board** for product/eng leads: what to fund, in what order, and what to refuse.

### 13.1 Do now (this sprint)

1. **Telemetry first (A1).** Without it every later KPI is anecdote. Owner: eng; exit: Sentry project + 3 funnel events + Web-Vitals dashboard.
2. **Prove B20 + Builder Codes on anvil (A4).** Kill or confirm the plan's riskiest assumption before UI. Owner: contracts/eng; exit: Foundry test green or documented fallback path chosen.
3. **Repair lint/CI honesty (A5).** Trivial cost, permanent debt otherwise.
4. **Draft the gap owners.** Each section 10 row gets a named owner in this doc's next revision (or a linked tracker) — unowned gaps become lesson L13.

### 13.2 Do before Phase-1 value moves

5. Heartbeat/reconnect ops ladder (A3) + signed config endpoint (A2).
6. ClaimHub UI + **match receipt page** (B1, B3) — the receipt is our differentiation demo, not a nice-to-have.
7. Web-push claim/turn nudges (B2) and live-ops notice strip (B5) — these protect claim-rate and freeze comms.
8. Sybil freeze (A6) + eligibility legal spot (A7) *before* any paid pool UI ships.
9. Dual-sign abandon grace (B4) — ranked economics are wrong without it.

### 13.3 Do after Phase-1 proves settle

10. Emotes/local room (B7, B8) only — **voice (C1) and i18n (C2) stay parked** until the stable-build gate in `docs/planning/RECOMMENDED_IMPLEMENTATION_PLAN.md` section 10 is green and explicitly un-parked.
11. Cosmetics cadence after the CHIPS value track; **rewarded-ads seam (C4) parked** with the other monetization gaps.
12. Frames + predict + paymaster (C6, C3, plan section 8.9) only with their gates intact.

> **Sequencing update (2026-09-22):** Current execution order is **engine + gaps first** (stable build), then CHIPS value, then growth. See `docs/planning/RECOMMENDED_IMPLEMENTATION_PLAN.md`.

### 13.4 Refuse (even when competitors have them)

| Refuse | Reason |
| --- | --- |
| Copy World's permission/fingerprint stack | Brand + trust damage on web; weakens our posture (L11) |
| Opaque server settle or push payouts | Would make us a worse King (L10, plan section 0) |
| Ads → CHIPS direct | Inflates emissions; violates single-currency discipline (L3) |
| UI-only anti-farm / UI-only gas floor | Industrial farms walk through UI (L8, L9) |
| Broad locale freeze without pipeline | Vanity i18n; ship pipeline + few locales instead (L5) |
| More board themes before ops surfaces | Content volume ≠ retention (L4) |

### 13.5 Success check for the *next* revision of this report

We can delete most of section 10.1 when: Sentry + funnels are live, config endpoint is signed and consumed, reconnect counters appear in one ops dashboard, lint runs in CI, and the Foundry Builder-Code test is green. We can mark section 10.5 progress when ClaimHub + receipt page are real. Update this file when engine or settlement behavior changes.

---

*Invariants this report must not regress: teams single truth (`TEAM_PAIRINGS` Green+Blue vs Red+Yellow), engine-math legality (`calculateNextPosition` / `getLegalTokenIndices`), Edge RNG receipts, pull-only CHIPS claims. Update this file when engine or settlement behavior changes, per the `ENGINE_LOGIC.md` living-doc rule.*
