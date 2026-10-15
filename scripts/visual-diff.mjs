#!/usr/bin/env node
/**
 * Visual-diff harness — CSS_LAYOUT_ANIMATION_PLAN.md, Phase 0.
 *
 * The plan's Phase 0 gate: "Playwright screenshots of 8 scenes (lobby, board
 * mid-game, spectate × Retro/Daybreak)". This is the harness that turns that
 * sentence into something a merge can fail on, and it is the precondition the
 * plan sets for every layout-shifting phase (reset layering, the globals.css
 * module split, fluid board clamp() sizing, container queries, the mass type
 * migration) — those change pixels app-wide, so they need a pixel gate first.
 *
 * Usage:
 *   npm run visual:baseline     # write/refresh tests/visual/baselines/*.png
 *   npm run visual:diff         # compare against them; exit 1 on regression
 *   node scripts/visual-diff.mjs --scene lobby-retro --update
 *
 * Requires a running app (VISUAL_BASE_URL, default http://127.0.0.1:3000).
 * Run it against a PRODUCTION build:
 *   npm run build && npm start
 * A dev server also works for the static scenes, but this repo documents that
 * Turbopack duplicates module ids across chunks (see AGENTS.md), which shows up
 * as "Invalid hook call / more than one copy of React" on the board's start
 * path — so the board scene only renders reliably against the webpack build.
 * Dev also injects its own overlay. The harness warns if it detects dev.
 *
 * Determinism. A screenshot gate is worthless if it is flaky, so every scene
 * pins: viewport + DPR, `reducedMotion: reduce` (which the app honors — that is
 * the P0 reduced-motion work), `animations: 'disabled'` on capture, the Next
 * dev overlay hidden, and a settle loop that waits for two byte-identical
 * consecutive frames. Volatile regions (remote avatars, ambient pulse dots,
 * the turn countdown, live counts) are MASKED rather than asserted, because
 * their content is not what this gate is protecting.
 *
 * Scenes. Four surfaces × two themes = the plan's 8:
 *   setup        — first-run panel (theme + token style)
 *   lobby        — dashboard lobby
 *   offline-panel— the offline/pass-and-play sheet
 *   board        — an offline AI match, started and rendered
 * "spectate" is deliberately NOT a scene: it requires a live networked match
 * (PeerJS + Edge), which no deterministic harness can conjure. Recorded in the
 * plan's §7 with the seeding work it would need.
 *
 * The diff runs in the browser (canvas), so the harness needs no image
 * dependency beyond the Playwright chromium already in devDependencies.
 *
 * What it does NOT catch: colour changes smaller than CHANNEL_TOLERANCE (12 per
 * channel). The Phase 1.1 accent deepening (#0e7490 → #0d6d87) is a 1–9 channel
 * delta and produced 0.000% here — colour is the contrast gate's job
 * (`scripts/contrast.mjs --pairs`), layout and structure are this one's.
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname ?? __dirname, '..');
const BASE_URL = process.env.VISUAL_BASE_URL || 'http://127.0.0.1:3000';
const BASELINE_DIR = join(ROOT, 'tests/visual/baselines');
const DIFF_DIR = join(ROOT, 'tests/visual/diffs');

const VIEWPORT = { width: 390, height: 844 };
/** Per-channel delta that counts as a changed pixel (antialiasing headroom). */
const CHANNEL_TOLERANCE = 12;
/** Fraction of the frame allowed to differ before the scene fails. */
const MAX_DIFF_RATIO = 0.002;

const argv = process.argv.slice(2);
const UPDATE = argv.includes('--update');
const AS_JSON = argv.includes('--json');
/** Treat a skipped production-only scene as a failure (CI: demand a real build). */
const STRICT = argv.includes('--strict');
const sceneFilter = (() => {
  const i = argv.indexOf('--scene');
  return i >= 0 ? argv[i + 1] : null;
})();

/** Volatile regions masked out of every capture. */
const ALWAYS_MASK = ['img[src^="http"]', '.animate-pulse', '.animate-spin'];

const SCENES = [
  { name: 'setup-retro', theme: 'retro', mask: ALWAYS_MASK, drive: driveSetup },
  { name: 'setup-daybreak', theme: 'light', mask: ALWAYS_MASK, drive: driveSetup },
  { name: 'lobby-retro', theme: 'retro', mask: [...ALWAYS_MASK, '.broadcast-anchor'], drive: driveLobby },
  { name: 'lobby-daybreak', theme: 'light', mask: [...ALWAYS_MASK, '.broadcast-anchor'], drive: driveLobby },
  { name: 'offline-panel-retro', theme: 'retro', mask: ALWAYS_MASK, drive: driveOfflinePanel },
  { name: 'offline-panel-daybreak', theme: 'light', mask: ALWAYS_MASK, drive: driveOfflinePanel },
  // Footer-nav panels — the wallet-free entry to each `.ludo-*-scope` subtree.
  // These exist so UI_DESIGN_AUDIT 1.2 (reset layering / spacing-repair
  // deletion) is provable: 457 panel-scoped spacing re-assertions live in
  // these subtrees and the six scenes above never open them.
  { name: 'panel-friends-retro', theme: 'retro', mask: ALWAYS_MASK, drive: (p, s) => drivePanel(p, s, 'Friends', 'ludo-friends-scope'), settle: 'panel' },
  { name: 'panel-friends-daybreak', theme: 'light', mask: ALWAYS_MASK, drive: (p, s) => drivePanel(p, s, 'Friends', 'ludo-friends-scope'), settle: 'panel' },
  { name: 'panel-rankings-retro', theme: 'retro', mask: ALWAYS_MASK, drive: (p, s) => drivePanel(p, s, 'Leaderboard', 'ludo-rankings-scope'), settle: 'panel' },
  { name: 'panel-rankings-daybreak', theme: 'light', mask: ALWAYS_MASK, drive: (p, s) => drivePanel(p, s, 'Leaderboard', 'ludo-rankings-scope'), settle: 'panel' },
  { name: 'panel-mission-retro', theme: 'retro', mask: ALWAYS_MASK, drive: (p, s) => drivePanel(p, s, 'Mission', 'ludo-mission-scope'), settle: 'panel' },
  { name: 'panel-mission-daybreak', theme: 'light', mask: ALWAYS_MASK, drive: (p, s) => drivePanel(p, s, 'Mission', 'ludo-mission-scope'), settle: 'panel' },
  { name: 'panel-arena-retro', theme: 'retro', mask: ALWAYS_MASK, drive: (p, s) => drivePanel(p, s, 'Arena', 'ludo-arena-scope'), settle: 'panel' },
  { name: 'panel-arena-daybreak', theme: 'light', mask: ALWAYS_MASK, drive: (p, s) => drivePanel(p, s, 'Arena', 'ludo-arena-scope'), settle: 'panel' },
  { name: 'panel-market-retro', theme: 'retro', mask: ALWAYS_MASK, drive: (p, s) => drivePanel(p, s, 'Market', 'ludo-market-scope'), settle: 'panel' },
  { name: 'panel-market-daybreak', theme: 'light', mask: ALWAYS_MASK, drive: (p, s) => drivePanel(p, s, 'Market', 'ludo-market-scope'), settle: 'panel' },
  // /burn renders BurnFeed standalone — the only wallet-free capture of a
  // component that was themed in JS (UI_DESIGN_AUDIT Phase 3).
  { name: 'burn-retro', theme: 'retro', mask: ALWAYS_MASK, path: '/burn', drive: driveBurnRoute, settle: 'panel' },
  { name: 'burn-daybreak', theme: 'light', mask: ALWAYS_MASK, path: '/burn', drive: driveBurnRoute, settle: 'panel' },
  // The board only renders reliably against the webpack production build: on a
  // Turbopack dev server, starting an offline match trips this repo's known
  // module-duplication issue ("Invalid hook call / more than one copy of
  // React" — see AGENTS.md on Turbopack chunk duplication) and the app's error
  // boundary takes over. These two are therefore skipped on a dev server.
  { name: 'board-retro', theme: 'retro', mask: [...ALWAYS_MASK, '.board-turn-status'], drive: driveBoard, requires: 'production' },
  { name: 'board-daybreak', theme: 'light', mask: [...ALWAYS_MASK, '.board-turn-status'], drive: driveBoard, requires: 'production' },
];

// ── Scene drivers ─────────────────────────────────────────────────────────
// Guest entry is the app's own no-wallet path: ToS gate → "Continue as Guest"
// → first-run panel → "Enter the lobby". Seeding `ludo-last-mode` pins the
// lobby dice carousel to the OFFLINE face so the board is reachable with two
// clicks instead of a wallet connect.

/**
 * Theme is set through the APP's own control and then ASSERTED on <body>,
 * never trusted to the seeded cookie alone: the first-run panel commits its
 * own default ('retro') when you enter the lobby, which silently overrode a
 * 'light' cookie and made every daybreak scene flip to dark between runs.
 *
 * The click is UNCONDITIONAL, and that matters for determinism. The theme
 * segmented control renders its selected segment from the `ludo-theme`
 * cookie, and the app re-commits its guest default at mount — so the cookie
 * the harness seeds can be overwritten before we look. When this only clicked
 * "if the body class is wrong", the panel could end up Daybreak-styled while
 * the control still showed Retro selected: whether applyTheme clicked at all
 * depended on a race with that default commit, and a fresh compile (slower
 * first paint) flipped the outcome. Measured as a 2.23% diff confined to the
 * control's 27px band. Clicking always makes the app write the preference
 * itself, so the captured state is the same on every run.
 */
async function applyTheme(page, theme) {
  const label = theme === 'light' ? 'Daybreak' : 'Retro';
  const cls = theme === 'light' ? 'theme-daybreak' : 'theme-retro-futurism';
  const has = () => page.evaluate((c) => document.body.classList.contains(c), cls).catch(() => false);
  for (let attempt = 0; attempt < 3; attempt++) {
    await clickIfPresent(page, label, 6000);
    await page.waitForTimeout(1500);
    if (await has()) return true;
  }
  return has();
}

async function driveSetup(page, scene) {
  // Seeded guest (see the init script) may already be active, which skips this.
  await clickIfPresent(page, 'Continue as Guest');
  await waitForText(page, 'Enter the lobby');
  if (!(await applyTheme(page, scene.theme))) {
    throw new Error(`theme "${scene.theme}" did not apply on the setup panel`);
  }
}

async function driveLobby(page, scene) {
  await driveSetup(page, scene);
  await clickText(page, 'Enter the lobby');
  await dismissCoachMark(page);
  // Re-assert: entering the lobby can commit the panel's own default theme.
  if (!(await applyTheme(page, scene.theme))) {
    throw new Error(`theme "${scene.theme}" did not apply in the lobby`);
  }
  // Changing the theme raises its own coach mark ("Make it yours"), which the
  // app also auto-dismisses on a timer — clear it so the two theme captures
  // stay structurally identical instead of racing that timer.
  await dismissCoachMark(page);
  // Lobby landmark: the dice carousel's action button. Its LABEL depends on the
  // remembered mode (we seed 'offline'), so match any of the three modes.
  await page
    .getByRole('button', { name: /QUICK MATCH|TEAM UP|OFFLINE MATCH/ })
    .first()
    .waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(1000);
}

async function driveOfflinePanel(page, scene) {
  await driveLobby(page, scene);
  const action = page.getByRole('button', { name: /OFFLINE MATCH|QUICK MATCH|TEAM UP/ }).first();
  const label = ((await action.textContent()) || '').trim();
  if (!/OFFLINE/i.test(label)) {
    throw new Error(`dice carousel booted on "${label}" — expected OFFLINE MATCH (is localStorage 'ludo-last-mode' seeded?)`);
  }
  await action.click({ timeout: 15000 });
  await waitForText(page, 'Start Offline Match');
}

async function driveBoard(page, scene) {
  await driveOfflinePanel(page, scene);
  await clickText(page, 'Start Offline Match');
  await page.locator('.board-grid').first().waitFor({ state: 'visible', timeout: 90000 });
  await dismissCoachMark(page);
  await page.waitForTimeout(1200);
}

/**
 * Footer-nav panels: Friends / Leaderboard / Mission / Arena / Market. Each is
 * the only wallet-free entry to a `.ludo-<panel>-scope` subtree, and those
 * scopes are exactly where the "Scoped spacing repair" re-assertions live
 * (UI_DESIGN_AUDIT 1.2). Without these the reset-layering change — which
 * touches every panel — would be unverifiable against the committed baselines.
 * Click by index-derived label, not role name: the buttons' accessible names
 * include the SVG, and the Next dev portal used to swallow the first two.
 */
async function drivePanel(page, scene, label, scopeClass) {
  await driveLobby(page, scene);
  const item = page
    .locator('.nav-item')
    .filter({ has: page.locator('.nav-label', { hasText: new RegExp(`^${label}$`) }) })
    .first();
  await item.click({ timeout: 20000 });
  await page.waitForSelector(`.${scopeClass}`, { state: 'visible', timeout: 30000 });
  await page.waitForTimeout(1200);
}

/** Route scenes (`path`) need no driving — just let the route settle. */
async function driveBurnRoute(page) {
  await page.waitForTimeout(1500);
}

/**
 * Panels carry async data that settles after the scope mounts. Poll for two
 * identical frames on the panel's own rows rather than a fixed timeout, so a
 * slow fetch cannot bake a half-populated list into a baseline.
 */
async function settlePanel(page, scopeClass) {
  await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve())).catch(() => {});
  let prev = null;
  for (let i = 0; i < 14; i++) {
    const shot = await page.screenshot({ animations: 'disabled' });
    if (prev && shot.equals(prev)) return true;
    prev = shot;
    await page.waitForTimeout(300);
  }
  return false;
}

// ── Page helpers ──────────────────────────────────────────────────────────

async function clickText(page, text) {
  const el = page.getByText(text, { exact: false }).first();
  await el.waitFor({ state: 'visible', timeout: 60000 });
  await el.click({ timeout: 15000 });
  await page.waitForTimeout(1200);
}

/** Click only if the control is there (seeded state can skip entry steps). */
async function clickIfPresent(page, text, timeout = 8000) {
  const el = page.getByText(text, { exact: false }).first();
  try {
    await el.waitFor({ state: 'visible', timeout });
    await el.click({ timeout });
    await page.waitForTimeout(1200);
    return true;
  } catch {
    return false;
  }
}

async function waitForText(page, text) {
  await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout: 60000 });
}

async function dismissCoachMark(page, rounds = 3) {
  // Coach marks appear a beat AFTER navigation and the app auto-dismisses them
  // on a timer, so one pass is not enough: a capture that races the timer flips
  // ~24% of the frame between runs. Click repeatedly until nothing is left.
  //
  // The wait is load-bearing. ThemeNudge mounts on a 1200ms timer, so a
  // dismissal pass that runs before it appears finds nothing, clicks nothing,
  // and the toast then pops into the capture — measured as a 1.3% flake in the
  // lobby scenes (a Chip + Button appearing over the rule selector). Wait out
  // the timer window first so the state is the same on every run.
  await page.waitForTimeout(1500);
  for (let r = 0; r < rounds; r++) {
    let clicked = false;
    for (const label of ['Later', 'Got it', 'Skip', 'Dismiss']) {
      const el = page.getByText(label, { exact: true }).first();
      if (await el.count().catch(() => 0)) {
        await el.click({ timeout: 2500 }).catch(() => {});
        await page.waitForTimeout(400);
        clicked = true;
      }
    }
    if (!clicked) return;
  }
}

/** Wait for two byte-identical consecutive frames (layout settled). */
async function settle(page) {
  // Webfonts are the classic visual-test flake: the same markup renders with
  // fallback metrics until they land. Wait for them explicitly first.
  await page.evaluate(() => (document.fonts ? document.fonts.ready : Promise.resolve())).catch(() => {});
  // The app derives its shell height and every fixed-bottom offset from the
  // visual viewport. A fractional visualViewport.height (headless browsers
  // report 843.x for an 844px viewport) used to round into a full pixel of
  // chrome movement — footer down 1px, centered content half a pixel — which
  // reads as a ~2% frame diff on an unchanged page. FrameProvider now snaps
  // sub-pixel noise away; assert the invariants so a future regression in that
  // logic fails as an environment error with this message instead of masquer-
  // ading as a visual diff.
  const vv = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return {
      inner: window.innerHeight,
      height: window.visualViewport ? +window.visualViewport.height.toFixed(3) : null,
      appVh: cs.getPropertyValue('--app-vh').trim(),
      dead: cs.getPropertyValue('--vv-dead-bottom').trim(),
      safe: cs.getPropertyValue('--safe-bottom').trim(),
    };
  });
  const problems = [];
  if (vv.appVh !== `${vv.inner}px`) problems.push(`--app-vh=${vv.appVh} but innerHeight=${vv.inner}`);
  if (vv.dead !== '0px') problems.push(`--vv-dead-bottom=${vv.dead}`);
  if (vv.safe !== '0px') problems.push(`--safe-bottom=${vv.safe}`);
  if (problems.length) {
    throw new Error(`viewport metrics not settled: ${problems.join('; ')} — re-run (FrameProvider snaps sub-pixel noise)`);
  }
  let prev = null;
  for (let i = 0; i < 14; i++) {
    const shot = await page.screenshot({ animations: 'disabled' });
    if (prev && shot.equals(prev)) return true;
    prev = shot;
    await page.waitForTimeout(300);
  }
  return false;
}

const HIDE_DEV_OVERLAY = `
  nextjs-portal, [data-next-badge-root], [data-nextjs-toast], #__next-build-watcher { display: none !important; }
  *, *::before, *::after { caret-color: transparent !important; }
`;

async function capture(page, scene) {
  const mask = scene.mask
    .map((sel) => page.locator(sel))
    .filter(Boolean);
  return page.screenshot({
    animations: 'disabled',
    caret: 'hide',
    mask,
    maskColor: '#ff00ff',
  });
}

// ── Pixel diff (in-browser; no image dependency) ───────────────────────────
async function diffPng(page, baselineDataUrl, currentDataUrl) {
  return page.evaluate(
    async ([a, b, tolerance]) => {
      const load = (src) =>
        new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error('image decode failed'));
          img.src = src;
        });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const w = Math.max(ia.width, ib.width);
      const h = Math.max(ia.height, ib.height);
      const read = (img) => {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, w, h);
      };
      const da = read(ia);
      const db = read(ib);
      const out = new Uint8ClampedArray(da.data.length);
      let changed = 0;
      for (let i = 0; i < da.data.length; i += 4) {
        const d = Math.max(
          Math.abs(da.data[i] - db.data[i]),
          Math.abs(da.data[i + 1] - db.data[i + 1]),
          Math.abs(da.data[i + 2] - db.data[i + 2]),
          Math.abs(da.data[i + 3] - db.data[i + 3])
        );
        if (d > tolerance) {
          changed++;
          out[i] = 255; out[i + 1] = 0; out[i + 2] = 0; out[i + 3] = 255;
        } else {
          out[i] = db.data[i]; out[i + 1] = db.data[i + 1]; out[i + 2] = db.data[i + 2]; out[i + 3] = 90;
        }
      }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').putImageData(new ImageData(out, w, h), 0, 0);
      return { changed, total: w * h, png: c.toDataURL('image/png') };
    },
    [baselineDataUrl, currentDataUrl, CHANNEL_TOLERANCE]
  );
}

// ── Main ──────────────────────────────────────────────────────────────────
const scenes = sceneFilter ? SCENES.filter((s) => s.name === sceneFilter) : SCENES;
if (scenes.length === 0) {
  console.error(`no scene matched --scene ${sceneFilter}`);
  console.error(`known scenes: ${SCENES.map((s) => s.name).join(', ')}`);
  process.exit(2);
}

try {
  const probe = await fetch(BASE_URL, { method: 'GET' });
  if (!probe.ok && probe.status >= 500) throw new Error(`status ${probe.status}`);
} catch (err) {
  console.error(`visual-diff: cannot reach ${BASE_URL} (${err.message}).`);
  console.error('Start the app first:  npm run dev');
  process.exit(2);
}

mkdirSync(BASELINE_DIR, { recursive: true });
const browser = await chromium.launch();
const results = [];
let failures = 0;

// Preflight: which server are we pointed at? This decides whether the
// production-only board scenes run or skip.
//
// Primary signal is a DEV-ONLY endpoint: `/__nextjs_source-map` exists on a dev
// server (it 400s without a query) and is a plain 404 on a production build.
// The Next dev overlay portal is kept as a secondary signal but is NOT
// trustworthy on its own — it only appears once the client has hydrated, and
// after a cache-cleared restart it was missing at probe time, which made the
// harness think it was pointed at production, run the board scenes, and fail
// them on the known Turbopack module-duplication issue instead of skipping.
const isDevServer = await (async () => {
  try {
    const res = await fetch(`${BASE_URL}/__nextjs_source-map`, { redirect: 'manual' });
    if (res.status !== 404) return true;
  } catch {
    /* fall through to the DOM probe */
  }
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();
  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForTimeout(1500);
    return await page.evaluate(() => !!document.querySelector('nextjs-portal'));
  } catch {
    return false;
  } finally {
    await ctx.close();
  }
})();
if (isDevServer) {
  console.log('! dev server detected — scenes that need a production build are skipped.');
  console.log('  Full set:  npm run build && npm start');
}

// One throwaway page serves every pixel comparison (the diff runs in a canvas).
const diffCtx = await browser.newContext();
const diffPage = await diffCtx.newPage();

for (const scene of scenes) {
  if (scene.requires === 'production' && isDevServer) {
    if (STRICT) failures++;
    results.push({ scene: scene.name, status: STRICT ? 'needs-production-build' : 'skipped' });
    console.log(`${STRICT ? '✗' : '·'} ${scene.name}: skipped — needs a production build (dev server detected)`);
    continue;
  }
  const baselinePath = join(BASELINE_DIR, `${scene.name}.png`);

  // One attempt = a fresh context (isolated cookies/localStorage) driven to the
  // scene, settled, captured. Retried once on failure on purpose: a visual gate
  // that dies on a single transient miss is a gate people switch off.
  const attemptOnce = async () => {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
      reducedMotion: 'reduce',
      colorScheme: scene.theme === 'light' ? 'light' : 'dark',
      locale: 'en-US',
      timezoneId: 'UTC',
    });
    // The theme cookie is an SSR hint only. The driver re-asserts the real theme
    // against <body> (applyTheme) because entering the lobby commits the app's
    // own default and silently overrides a seeded cookie.
    await context.addCookies([{ name: 'ludo-theme', value: scene.theme, url: BASE_URL }]);
    await context.addInitScript(() => {
      // Deterministic identity. Without this, every run mints a fresh guest
      // (`lib/guest.ts` → crypto.getRandomValues) and the profile chip renders a
      // different handle each time — measured at ~5.9% of the frame, pure flake.
      try {
        localStorage.setItem('ludo-guest-id', 'guest_5eed01');
        localStorage.setItem('ludo-guest-active', '1');
        // Pin the lobby dice carousel to the OFFLINE face so the board is
        // reachable with two clicks instead of a wallet connect.
        localStorage.setItem('ludo-last-mode', 'offline');
      } catch {
        /* storage unavailable */
      }
    });
    await context.addInitScript({ content: `document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(HIDE_DEV_OVERLAY)}; document.head.appendChild(s); });` });

    const page = await context.newPage();
    try {
      // `path` lets a scene target a real route instead of the SPA root —
      // /burn renders BurnFeed standalone, which is the only wallet-free way
      // to capture it (in-app it opens from the chips chip behind a connect).
      await page.goto(BASE_URL + (scene.path ?? ''), { waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.waitForTimeout(2500);
      // Warm-up reload: a dev server compiles the route and serves webfonts
      // lazily, so a first paint can land before the display font is applied —
      // measured as a 27% text-only diff. Capture on the second load instead.
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.waitForTimeout(2000);
      await scene.drive(page, scene);
      // Late coach marks: wait for them to appear, then clear them, THEN settle.
      await page.waitForTimeout(1500);
      await dismissCoachMark(page);
      const stable = scene.settle === 'panel' ? await settlePanel(page, scene) : await settle(page);
      const captured = await capture(page, scene);
      return { shot: captured, error: stable ? null : 'frame never stabilised (captured the last of 14 attempts)' };
    } catch (err) {
      return { shot: null, error: err.message };
    } finally {
      await context.close();
    }
  };

  let { shot, error } = await attemptOnce();
  if (!shot) {
    console.log(`  ↻ retrying ${scene.name} — ${error}`);
    ({ shot, error } = await attemptOnce());
  }
  if (!shot) {
    failures++;
    results.push({ scene: scene.name, status: 'error', detail: error });
    console.log(`✗ ${scene.name}: ${error}`);
    continue;
  }

  if (UPDATE || !existsSync(baselinePath)) {
    writeFileSync(baselinePath, shot);
    results.push({ scene: scene.name, status: existsSync(baselinePath) && UPDATE ? 'updated' : 'created', bytes: shot.length });
    console.log(`✓ ${scene.name}: baseline ${UPDATE ? 'written' : 'created'} (${shot.length} B)`);
    continue;
  }

  const baseline = readFileSync(baselinePath);
  const { changed, total, png } = await diffPng(
    diffPage,
    `data:image/png;base64,${baseline.toString('base64')}`,
    `data:image/png;base64,${shot.toString('base64')}`
  );
  const ratio = changed / total;
  if (ratio > MAX_DIFF_RATIO) {
    failures++;
    mkdirSync(DIFF_DIR, { recursive: true });
    const diffPath = join(DIFF_DIR, `${scene.name}.png`);
    const currentPath = join(DIFF_DIR, `${scene.name}.current.png`);
    writeFileSync(diffPath, Buffer.from(png.split(',')[1], 'base64'));
    // Keep the actual capture too: without it a failure is undiagnosable.
    writeFileSync(currentPath, shot);
    results.push({ scene: scene.name, status: 'changed', ratio, diffPath, currentPath });
    console.log(`✗ ${scene.name}: ${(ratio * 100).toFixed(3)}% of pixels differ (limit ${(MAX_DIFF_RATIO * 100).toFixed(1)}%)`);
    console.log(`    diff:    ${diffPath}`);
    console.log(`    current: ${currentPath}`);
  } else {
    results.push({ scene: scene.name, status: 'match', ratio });
    console.log(`✓ ${scene.name}: match (${(ratio * 100).toFixed(3)}% differing)`);
  }
}

await diffCtx.close();
await browser.close();

if (AS_JSON) console.log(JSON.stringify({ update: UPDATE, baseUrl: BASE_URL, results }, null, 2));

if (failures > 0) {
  console.log(`✗ visual-diff failed: ${failures} scene(s) regressed. Inspect tests/visual/diffs/, then either fix the change or re-baseline with \`npm run visual:baseline\` (and justify it in the PR).`);
  process.exit(1);
}
console.log(`✓ visual-diff clean (${scenes.length} scene${scenes.length === 1 ? '' : 's'}${UPDATE ? ', baselines written' : ''})`);
