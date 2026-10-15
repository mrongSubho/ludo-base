/**
 * The Mission panel badge must never be undefined.
 *
 * Regression: MissionPanel used to switch on a `type` wire field left over from
 * the old hardcoded DAILY_MISSIONS table. Commit 1084c72 ("missions on CHIPS,
 * single reward source") replaced that source with `mission_catalog` (migration
 * 202609300003), which has no `type` column — so `/api/missions/list` stopped
 * sending it. The switch fell through for every mission, the badge was
 * undefined, and `badge.bg` threw "Cannot read properties of undefined
 * (reading 'bg')" on the first mission row, taking the whole panel down for
 * every signed-in user (the guest path renders a different branch, which is why
 * the panel-mission visual scenes never caught it).
 *
 * `missionBadgeFor()` is now keyed off `mission_id` — a field the catalog
 * actually has — and total by construction. This test pins both properties and
 * pins the API/panel agreement that broke.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { missionBadgeFor, SEEDED_MISSION_IDS } from '../lib/missionBadge';

const root = join(import.meta.dirname ?? __dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const code = (p: string) =>
    read(p)
        .split('\n')
        .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
        .join('\n');

const panel = code('app/components/MissionPanel.tsx');
const route = code('app/api/missions/list/route.ts');

// ── the mapper is total ────────────────────────────────────────────────────

test('every mission_id seeded by 202609300003 gets a defined badge', () => {
    assert.ok(SEEDED_MISSION_IDS.length >= 12, 'the seeded id list drifted from the migration');
    for (const id of SEEDED_MISSION_IDS) {
        const badge = missionBadgeFor(id);
        assert.ok(badge !== undefined && badge !== null, `${id} produced an undefined badge`);
        assert.match(badge.bg, /^bg-/, `${id} has no bg class`);
        assert.match(badge.color, /^text-/, `${id} has no color class`);
    }
});

test('each seeded mission maps to its intended icon', () => {
    assert.equal(missionBadgeFor('daily_bonus').key, 'bonus');
    assert.equal(missionBadgeFor('daily_play_3').key, 'play');
    assert.equal(missionBadgeFor('weekly_play_10').key, 'play');
    assert.equal(missionBadgeFor('daily_win_1').key, 'win');
    assert.equal(missionBadgeFor('weekly_win_3').key, 'win');
    assert.equal(missionBadgeFor('daily_capture_2').key, 'capture');
    assert.equal(missionBadgeFor('weekly_pvp_2').key, 'capture');
    assert.equal(missionBadgeFor('daily_poke_back').key, 'poke');
    assert.equal(missionBadgeFor('daily_predict_1').key, 'predict');
    assert.equal(missionBadgeFor('weekly_spectate_5').key, 'predict');
    assert.equal(missionBadgeFor('weekly_friend_dm_3').key, 'social');
});

test('unknown, empty, and non-string ids fall back to the neutral badge', () => {
    const unknowns = ['', 'daily_quantum_7', 'weekly_zzz', 'x', undefined as unknown as string, null as unknown as string];
    for (const id of unknowns) {
        const badge = missionBadgeFor(id);
        assert.equal(badge.key, 'default', `${String(id)} must fall back, not return undefined`);
        assert.ok(badge.bg && badge.color, `${String(id)} must still carry style classes`);
    }
});

// ── the API/panel agreement that broke ──────────────────────────────────────

test('the missions API never reintroduces a `type` field on the wire', () => {
    assert.doesNotMatch(route, /^\s*type:/m, 'a `type:` key on the payload would revive the phantom field');
});

test('the Mission panel no longer reads a mission `type` field', () => {
    assert.ok(!panel.includes('mission.type'), 'mission.type is a field the API does not send');
    assert.ok(!panel.includes("Mission['type']"), 'Mission[type] typing hides the phantom field');
    assert.match(panel, /missionBadgeFor\(mission\.id\)/, 'the badge must key off mission.id');
});
