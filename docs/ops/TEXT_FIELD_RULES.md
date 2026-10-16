# Ludo Base — Text field rules (consolidated)

| | |
|---|---|
| **Date** | 2026-10-16 |
| **Scope** | Every `<input>` / `<textarea>` in `app/**` — DM & broadcast composers, search boxes, address/code fields, numeric fields, identity fields — plus the mobile keyboard machinery that governs them |
| **Method** | Static extraction of all 26 field tags with their attributes, plus the CSS/JS that reacts to focus |
| **Question answered** | "What rules apply to DM/broadcast and search fields (disabled suggestions, disabled autofill), and what are the mobile keyboard pop-up behaviors?" |

---

## 1. The shared vocabulary — the "no OS interference" set

The answer to *disabled suggestions / disabled autofill* is one four-attribute set, applied
deliberately to any field whose content is a **code, address, handle, or amount** — values the OS
would corrupt if it "helped":

```tsx
autoComplete="off"      // no autofill dropdown / saved-value suggestions
autoCorrect="off"       // no autocorrect rewriting
autoCapitalize="none"   // no sentence-capitalisation of the first character
spellCheck={false}      // no red squiggles / spell suggestions
```

**Enforced in:** the DM composer (`RichChatField.tsx:107-109`), the broadcast composers, all five
search fields, and every wallet address/amount field. This is the house default for
non-prose input; deviating from it is what the inconsistency list in §6 is about.

### 1.1 Deliberate exceptions (prose vs. codes)

| Field | Deviation | Why |
|---|---|---|
| `RichChatField` (DM + match chat + live chat) | **No `autoCapitalize`** → OS default (sentences) | chat is prose; the other three attributes still apply |
| `SpectatorHUD.tsx:669` (broadcast "Transmit data…") | `autoCapitalize="sentences"` | explicit prose intent |
| `InGameWalletPanel.tsx:399` (OTP) | `autoComplete="one-time-code"` | **positive** autofill — the SMS-code suggestion is wanted |
| `InGameWalletPanel.tsx:410` (email) | `type="email" autoComplete="email"` | **positive** autofill — password-manager/email suggestion is wanted |

---

## 2. Field type A — DM & chat composers

**Component:** `app/components/RichChatField.tsx` (the canonical field). **Call sites:** match chat
(`Board.tsx:493`), DM thread (`MessagesPanel.tsx:802`), live-arena chat (`ActivityFeed.tsx:301`),
broadcast card (`ActivityFeed.tsx:1268`).

| Rule | Where enforced | Behaviour it affects |
|---|---|---|
| `rows={1}` + `resize: none` + content-driven growth capped at `max-height: 96px` with `overflow-y: auto` | `RichChatField.tsx:106`, `globals.css:9436-9438, 9453` | one-line start, grows with the draft, then scrolls instead of pushing the composer off-screen |
| `maxLength={500}` (default prop) | `RichChatField.tsx:38, 103` | hard cap; the counter slot reserves `padding-right: 54px` (`globals.css:9471-9474`) |
| `enterKeyHint="send"` | `RichChatField.tsx:110` | mobile keyboard's action key reads **Send** |
| `autoComplete="off" autoCorrect="off" spellCheck={false}` | `:107-109` | no autofill, no autocorrect, no spell marks |
| Transparent text layer over a mirrored painted layer | `RichChatField.tsx:66-111`, `globals.css:9424-9458` | real caret/selection/IME, with emote art painted at the exact shortcode positions (`color: transparent` + `-webkit-text-fill-color: transparent` + `caret-color`) |
| `caret-color` themed | `globals.css:9455` (Retro `#22d3ee`), `10059-10061` (Daybreak `#0052ff`) | caret stays visible on both themes |
| Enter sends | `ActivityFeed.tsx:308, 1275`, `MessagesPanel.tsx:809`, `Board.tsx:500` (`onKeyDown`) | submit without reaching for the button |
| `disabled` + a "Wait Ns…" placeholder during cooldown | `ActivityFeed.tsx:309-310`, `MessagesPanel.tsx:810-811` | anti-spam is *visible* rather than a dead field |
| Disabled state: `opacity: .5` | `globals.css:9467-9469` | field reads as unavailable |

**Broadcast variant** — `SpectatorHUD.tsx:669`: same four-attribute set (with
`autoCapitalize="sentences"`), `enterKeyHint="send"`, `rows={1}`, `maxLength={120}`,
`placeholder="Transmit data…"`. The tighter cap is the broadcast-specific rule.

---

## 3. Field type B — Search boxes

**All five, identical rule set:** `FriendsPanel.tsx:753`, `MarketplacePanel.tsx:862`,
`MessagesPanel.tsx:662`, `RankingsPanel.tsx:270` ("Search players"), `SwapSheet.tsx:65` (token
picker, class `.tkpick-search`).

| Rule | Where enforced | Behaviour it affects |
|---|---|---|
| `autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false}` | each site | the OS never suggests, corrects, or capitalises a query |
| `enterKeyHint="search"` | each site | keyboard action key reads **Search** (magnifier) instead of Return |
| `rows={1}` + `resize-none overflow-hidden` + bare field styling (`bg-transparent border-0 p-0`) | each site (`SwapSheet` uses `.tkpick-search`, `globals.css:8216-8229`) | the wrapper supplies the visible box; the field is chrome-less so it can sit inside a pill |
| No `<form>` / no submit handler | — | filtering is live on `onChange`; the action key is a no-op affordance |

---

## 4. Field type C — Address, code & wallet fields

All use the four-attribute set; the differences are keyboard type and the action key.

| Field | File:line | Extra rules |
|---|---|---|
| Send recipient | `SendTokenSheet.tsx:163` | `enterKeyHint="next"`, monospace (`.fld-text`), `resize-none overflow-hidden` |
| Send recipient (native) | `SendNativeSheet.tsx:34` | `enterKeyHint="next"` |
| Link a wallet | `WalletLinkPanel.tsx:193` | `enterKeyHint="done"`, monospace (`.wl-input`), focus ring via `border-color` (`globals.css:9065-9068`) |
| WalletConnect URI | `WcWalletPanel.tsx:283` | `autoComplete="off" spellCheck={false}` **only** — see §6 |
| Invite link / room code | `TeamUpMatchPanel.tsx:927` | `type="text" autoComplete="off" spellCheck={false}` — **no `autoCapitalize="none"`** — see §6 |
| Referral code | `OnboardingPanel.tsx:486` | **no suppression attributes at all** — see §6 |

## 5. Field type D — Numeric, identity & settings fields

| Field | File:line | Rules |
|---|---|---|
| Token amount | `SendTokenSheet.tsx:119` | `inputMode="decimal"` + the four-attribute set; `.fld-amt-input` is 34px/tabular-nums (`globals.css:7974-7986`) |
| Native amount | `SendNativeSheet.tsx:49` | `inputMode="decimal"`, `enterKeyHint="done"` |
| Swap amount / slippage | `SwapSheet.tsx:153, 205` | `inputMode="decimal"` / `inputMode="numeric"` |
| OTP | `InGameWalletPanel.tsx:399` | `inputMode="numeric"`, `autoComplete="one-time-code"`, `maxLength={6}` |
| Email | `InGameWalletPanel.tsx:410` | `type="email"`, `autoComplete="email"` |
| Display name | `UserProfilePanel.tsx:469` | `maxLength={NAME_RULES.max}` (16); validated by `lib/avatars.ts:110-125`: **3–16 chars**, `/^[A-Za-z0-9_]+$/`, cannot start with `0x`, reserved `guest`/`user` prefixes |
| Support feedback | `SettingsPanel.tsx:341` | `maxLength={2000}`, `rows={5}` (prose — no suppression attributes) |
| Custom reaction | `EmoteTray.tsx:114` | `maxLength={32}`, `autoFocus`, Enter saves / Escape cancels — **no suppression attributes** — see §6 |
| Bet amount | `GameLobby.tsx:457` | `type="number"` — see §6 |
| Listing price | `MarketplacePanel.tsx:1480` | `type="number"` — see §6 |

---

## 6. Mobile keyboard pop-up behaviour (the machinery)

### 6.1 Viewport contract — `app/layout.tsx:42-48`

```ts
width: 'device-width', initialScale: 1,
maximumScale: 1,                 // blocks the iOS focus-zoom (see §7 note)
viewportFit: 'cover',            // safe-area insets are real
interactiveWidget: 'resizes-content',  // keyboard RESIZES content instead of overlaying it
```

`interactiveWidget: 'resizes-content'` is why the app can lay out against a shrinking viewport
instead of a keyboard covering the bottom third.

### 6.2 The focus engine — `app/components/FrameProvider.tsx:41-169`

| Step | Line | Behaviour |
|---|---|---|
| `focusin` on an editable (`input, textarea, select, [contenteditable]`) | `:124-134` | marks `keyboardOpen`, recomputes immediately, then re-scrolls at **50ms and 220ms** (the keyboard's own open animation) |
| Keyboard inset | `:90-94` | `kbInset` = the visual-viewport delta, but **only if > 120px** — URL-bar collapse and host chrome are ignored |
| `--kb-inset` + `body.keyboard-open` | `:106-107` | published to CSS; the class is what all keyboard CSS hangs off |
| App height freeze | `:95-101` | while the keyboard is open, `--app-vh` is pinned to the **pre-IME** height so the board never reflows behind the keyboard |
| Reveal a clipped field | `:47-62` | `scrollIntoView({ block: 'nearest' })` **only** when the control is actually clipped (24px margin) — the old unconditional `block: 'center'` used to park the field mid-screen and push panel headers out of view |
| `focusout` | `:135-141` | 120ms debounce, and it ignores focus moving *between* fields — tabbing doesn't flicker the chrome |
| Tab hidden / rotation | `:142-156` | resets `keyboardOpen`, clears the inset, re-baselines the stable height |
| Re-baseline | `:111-114` | after rotation/URL-bar change, the next non-keyboard frame becomes the new stable height |

### 6.3 What the CSS does while `body.keyboard-open` (`globals.css`)

| Rule | Line | Behaviour |
|---|---|---|
| `.footer-nav` hidden | `1702-1705` | the IME owns the bottom edge; the nav never floats above the keyboard |
| Panel `max-height: calc(var(--visible-vh) - 64px - 8px)` | `5694-5710` | panels shrink to the *visible* viewport so their content stays reachable |
| `padding-bottom` + `scroll-padding-bottom: max(24px, var(--kb-inset), var(--safe-bottom))` | `5713-5720` | focused content scrolls clear of the keyboard, and the safe area is never double-counted |
| `.board-sheet { bottom: calc(var(--kb-inset) + 8px) }` | `9968-9969` | the chat sheet rides above the keyboard |
| `.match-footer-chat { bottom: var(--kb-inset) }` | `9971-9972` | the match composer lifts with it |
| `.chat-sheet-presets { display: none }` | `9974-9976` | the quick-phrase row yields to the IME |

### 6.4 Action-key & keyboard-type mapping

| `enterKeyHint` | Fields | Mobile key reads |
|---|---|---|
| `"send"` | all chat/DM/broadcast composers | Send |
| `"search"` | all five search boxes | Search (magnifier) |
| `"next"` | send recipient, token amount | Next (field-to-field) |
| `"done"` | link wallet, native amount | Done (dismiss keyboard) |

| `inputMode` | Fields |
|---|---|
| `"decimal"` | token/native/swap amounts |
| `"numeric"` | slippage bps, OTP |
| *(default text)* | search, chat, addresses, codes |

---

## 7. Inconsistencies found (actionable)

1. **`TeamUpMatchPanel.tsx:927` — invite link / room code has no `autoCapitalize="none"`.**
   Room codes are case-sensitive; iOS sentence-capitalisation can upper-case the first character of a
   typed code, producing a "code not found" failure that looks like a server problem. Add the full
   four-attribute set (it currently has `autoComplete` + `spellCheck` only).
2. **`WcWalletPanel.tsx:283` — the `wc:` URI field** has only `autoComplete="off"` +
   `spellCheck={false}`. URIs are case-sensitive and long; add `autoCorrect="off"` and
   `autoCapitalize="none"`.
3. **`OnboardingPanel.tsx:486` — referral code** has **no** suppression attributes, no `maxLength`,
   and no pattern. Referral codes are exactly the case-sensitive-short-code case the four-attribute
   set exists for.
4. **`EmoteTray.tsx:114` — custom reaction** has no suppression attributes; the sibling chat field
   disables `spellCheck`. Low risk (user-authored text) but inconsistent.
5. **`GameLobby.tsx:457` and `MarketplacePanel.tsx:1480` use `type="number"`.** Native number
   inputs accept scroll-wheel changes while merely hovering, and expose locale-dependent decimal
   separators. Every other amount field in the app uses `inputMode="decimal"` on a text field —
   these two are the outliers.
6. **`maximumScale: 1` blocks pinch-zoom for everyone.** It is what prevents the iOS focus-zoom
   (the app's fields are 12–15px, below the 16px threshold), but it also removes user zoom — a
   WCAG 1.4.4 consideration. The alternative is a 16px minimum on mobile field fonts; that is a
   design decision, not a bug.

---

## 8. Index — where each rule lives

| Concern | Owner |
|---|---|
| Field component (chat/DM) | `app/components/RichChatField.tsx` |
| Field styling | `app/globals.css` — `.rich-field*` (9411-9490), `.fld-text` / `.fld-amt-input` (7974-8023), `.tkpick-search` (8216-8229), `.wl-input` (9054-9068), `.ingame-input` (8672-8695), `.sw-amt-input` (8105-8117) |
| Keyboard engine | `app/components/FrameProvider.tsx:41-169` |
| Keyboard CSS | `app/globals.css:1650-1661` (tokens), `1702-1705`, `5694-5720`, `9968-9976` |
| Viewport contract | `app/layout.tsx:42-48` |
| Name validation | `lib/avatars.ts:110-125` (`NAME_RULES`) |
| Search-field shell styling | the wrapping pill in each panel (`FriendsPanel`, `MarketplacePanel`, `MessagesPanel`, `RankingsPanel`) |
