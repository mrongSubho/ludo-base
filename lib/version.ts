// ─── App version (single source of truth) ───────────────────────────────────
// Scheme: v<MAJOR>.<MINOR>.<PATCH>-<STAGE>, e.g. v0.1.528-beta.
//
// - MAJOR 0 = pre-launch beta. Ships as 1 at public launch (stage tag drops).
// - MINOR +1 per milestone / feature drop (0.2.x, 0.3.x, …).
// - PATCH is the repo commit count, injected at build time via
//   NEXT_PUBLIC_BUILD_NUMBER — every commit increments it automatically,
//   monotonically (never resets, so versions never collide).
// - STAGE 'beta' until the 1.0 launch.

const APP_MAJOR = 0;
const APP_MINOR = 1;
const APP_STAGE = 'beta';

function buildNumber(): string {
    const raw = process.env.NEXT_PUBLIC_BUILD_NUMBER || '';
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? String(n) : 'dev';
}

export const APP_VERSION = `v${APP_MAJOR}.${APP_MINOR}.${buildNumber()}${APP_STAGE ? `-${APP_STAGE}` : ''}`;

export const APP_BUILD_HASH = process.env.NEXT_PUBLIC_GIT_HASH || 'dev';
