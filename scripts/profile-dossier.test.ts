import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname ?? __dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('Pilot Dossier & Public Profile Synchronization', () => {
    it('UserProfilePanel splits into 3 tabs, removes redundant Open wallet CTA, and uses useTotalChips', () => {
        const src = read('app/components/UserProfilePanel.tsx');

        assert.match(src, /type ProfileTab = 'overview' \| 'performance' \| 'history'/);
        assert.match(src, /cols=\{3\}/);
        assert.match(src, /value:\s*'overview'/);
        assert.match(src, /value:\s*'performance'/);
        assert.match(src, /value:\s*'history'/);

        // Unified CHIPS source of truth
        assert.match(src, /useTotalChips\(/);
        assert.match(src, /formatCompactChips\(/);
        assert.doesNotMatch(src, /Open wallet · assets & activity/);

        // 3077 Shell & compositor gauges (no width layout animation)
        assert.match(src, /<GamePanelShell/);
        assert.match(src, /<HudProgressGauge/);
        assert.match(src, /<PilotAvatar/);
        assert.doesNotMatch(src, /animate=\{\{\s*width:/);
    });

    it('UserProfilePanel wires privacy toggles to POST /api/profile with optimistic rollback', () => {
        const src = read('app/components/UserProfilePanel.tsx');

        assert.match(src, /profile\?\.is_public \?\? true/);
        assert.match(src, /profile\?\.allow_requests \?\? true/);
        assert.match(src, /fetch\('\/api\/profile'/);
        assert.match(src, /isPublic:\s*nextPublic/);
        assert.match(src, /allowRequests:\s*nextRequests/);
        assert.match(src, /<Switch/);
    });

    it('UserProfilePanel upgrades identity customizer with live badge preview & series filters', () => {
        const src = read('app/components/UserProfilePanel.tsx');

        assert.match(src, /Live Badge Preview/);
        assert.match(src, /Avatar Series/);
        assert.match(src, /draftValidationErr/);
        assert.match(src, /encodeAvatar\(draftAvatarId\)/);
    });

    it('PublicProfileModal syncs to 3077 shell, uses PilotAvatar, and honors privacy settings', () => {
        const src = read('app/components/PublicProfileModal.tsx');

        assert.match(src, /panel-shell-3077/);
        assert.match(src, /<HudCornerTicks/);
        assert.match(src, /<CloseReticleIcon/);
        assert.match(src, /<PilotAvatar/);
        assert.match(src, /\/api\/profile\/public\?walletAddress=/);
        assert.match(src, /Restricted Dossier/);
        assert.match(src, /Requests Paused/);
        assert.match(src, /clan_tag/);
        assert.doesNotMatch(src, /cosmic-orb/);
    });

    it('PilotAvatar resolves AvatarDef and keeps explicit image dimensions', () => {
        const src = read('app/components/PilotAvatar.tsx');

        assert.match(src, /resolveAvatarDef/);
        assert.match(src, /isDirectImage/);
        assert.match(src, /width=\{96\}\s+height=\{96\}/);
    });

    it('Backend profile, public profile, friendships, and SQL migration persist and enforce privacy', () => {
        const mig = read('supabase/migrations/202611200001_profile_privacy.sql');
        assert.match(mig, /^begin;/m);
        assert.match(mig, /is_public boolean not null default true/i);
        assert.match(mig, /allow_requests boolean not null default true/i);
        assert.match(mig, /grant select \(is_public, allow_requests\) on public\.players to anon, authenticated/i);
        assert.match(mig, /^commit;/m);

        const profileRoute = read('app/api/profile/route.ts');
        assert.match(profileRoute, /is_public, allow_requests/);
        assert.match(profileRoute, /updates\.is_public = isPublic/);
        assert.match(profileRoute, /updates\.allow_requests = allowRequests/);

        const publicRoute = read('app/api/profile/public/route.ts');
        assert.match(publicRoute, /privateRedacted/);
        assert.match(publicRoute, /getClanTagsForWallets/);

        const friendsRoute = read('app/api/friendships/route.ts');
        assert.match(friendsRoute, /allow_requests === false/);
        assert.match(friendsRoute, /status:\s*403/);
    });

    it('Footer uses Ranking label and equal 5-column sizing; Rankings & Leaderboard use compact sports standings table', () => {
        const footerSrc = read('app/components/FooterNavPanel.tsx');
        assert.match(footerSrc, /id:\s*'leaderboard'[^}]*label:\s*'Ranking'/);
        assert.doesNotMatch(footerSrc, /label:\s*'Leaderboard'/);

        const panelsCss = read('app/styles/panels.css');
        assert.match(panelsCss, /grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/);
        const theme3077Css = read('app/styles/themes/theme-3077.css');
        assert.match(theme3077Css, /flex:\s*1 1 0%/);

        for (const f of ['app/components/RankingsPanel.tsx', 'app/components/Leaderboard.tsx']) {
            const src = read(f);
            assert.match(src, /grid-cols-\[30px_minmax\(0,1fr\)_36px_62px\]/);
            assert.match(src, /<PilotAvatar/);
            assert.match(src, /<span>Ranking<\/span>/);
        }
    });

    it('Assigns random avatars from the 18 pilot list to existing empty players and all new players', async () => {
        const { PILOT_AVATAR_IDS, pickRandomPilotAvatar } = await import('../lib/avatars');
        assert.equal(PILOT_AVATAR_IDS.length, 18);
        const validSet = new Set(PILOT_AVATAR_IDS.map((id) => `avatar:${id}`));
        for (let i = 0; i < 40; i++) {
            assert.ok(validSet.has(pickRandomPilotAvatar()));
        }

        const mig = read('supabase/migrations/202611220001_default_random_pilot_avatar.sql');
        assert.match(mig, /^begin;/m);
        assert.match(mig, /random_pilot_avatar\(\)/);
        assert.match(mig, /players_default_random_avatar/);
        assert.match(mig, /before insert on public\.players/i);
        assert.match(mig, /update public\.players\s+set avatar_url = public\.random_pilot_avatar\(\)/i);
        for (const id of PILOT_AVATAR_IDS) {
            assert.match(mig, new RegExp(`'avatar:${id}'`));
        }
        assert.match(mig, /^commit;/m);

        for (const f of [
            'lib/serverAuth.ts',
            'lib/sessionV2.ts',
            'app/api/siwe/verify/route.ts',
            'lib/spectatorBetting.ts',
            'app/api/profile/route.ts',
        ]) {
            assert.match(read(f), /pickRandomPilotAvatar\(/, `${f} should assign pickRandomPilotAvatar()`);
        }
    });
});
