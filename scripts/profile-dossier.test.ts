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
});
