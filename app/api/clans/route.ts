/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from 'next/server';
import { requireSession, requireAppSession } from '@/lib/serverAuth';
import { checkRateLimit, rateKey, rateLimitHeaders } from '@/lib/rateLimit';
import {
    searchClans,
    getClan,
    getPlayerClan,
    getClanMembers,
    getJoinRequests,
    getNextClanLevelConfig,
    getClanTreasuryLedger,
    getClanMissionsAndVault,
    checkClanAvailability,
    createClan,
    ClanServiceError,
} from '@/lib/clan/clanService';

/**
 * GET /api/clans
 * - ?mine=true: returns caller's clan, membership, level configs, roster, requests (if officer), treasury ledger, and missions/vault
 * - ?check=true&name=...&tag=...: pre-flight availability & CHIPS balance check before on-chain creation tx
 * - ?clanId=<id>: returns single clan dossier + members
 * - ?query=...&division=...: search & discover clans
 */
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const mine = searchParams.get('mine') === 'true';
        const check = searchParams.get('check') === 'true';
        const clanId = searchParams.get('clanId');
        const query = searchParams.get('query') || undefined;
        const division = searchParams.get('division') || undefined;
        const limit = Number(searchParams.get('limit') || 20);
        const offset = Number(searchParams.get('offset') || 0);

        if (check) {
            const session = await requireSession(request, 'app');
            if (!session?.wallet) {
                return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
            }
            const name = searchParams.get('name') || '';
            const tag = searchParams.get('tag') || '';
            const result = await checkClanAvailability({
                walletAddress: session.wallet,
                name,
                tag,
            });
            return NextResponse.json(result);
        }

        if (mine) {
            const session = await requireSession(request, 'app');
            if (!session?.wallet) {
                return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
            }
            const authed = session.wallet;
            const data = await getPlayerClan(authed);
            if (!data) {
                return NextResponse.json({
                    clan: null,
                    member: null,
                    levelConfig: null,
                    nextLevelConfig: null,
                    members: [],
                    joinRequests: [],
                    treasuryLedger: [],
                    missions: [],
                    weeklyVault: null,
                });
            }

            const isOfficer = ['commander', 'officer'].includes(data.member.role);
            const [nextLevelConfig, members, joinRequests, treasuryLedger, missionState] = await Promise.all([
                getNextClanLevelConfig(data.clan.level),
                getClanMembers(data.clan.id),
                isOfficer ? getJoinRequests(data.clan.id) : Promise.resolve([]),
                getClanTreasuryLedger(data.clan.id, 20),
                getClanMissionsAndVault(data.clan.id, authed),
            ]);

            return NextResponse.json({
                clan: data.clan,
                member: data.member,
                levelConfig: data.levelConfig,
                nextLevelConfig,
                members,
                joinRequests,
                treasuryLedger,
                missions: missionState.contracts,
                weeklyVault: missionState.weeklyVault,
            });
        }

        if (clanId) {
            const clan = await getClan(clanId);
            if (!clan) return NextResponse.json({ error: 'Clan not found' }, { status: 404 });
            const members = await getClanMembers(clanId);
            return NextResponse.json({ clan, members });
        }

        const result = await searchClans({ query, division, limit, offset });
        return NextResponse.json(result);
    } catch (err: any) {
        console.error('[clans:GET]', err);
        return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 });
    }
}

/**
 * POST /api/clans
 * Create a new clan. Atomically debits 10,000 CHIPS from escrow or verifies on-chain transfer.
 */
export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => ({}));
        const authed =
            (await requireSession(request, 'app'))?.wallet ||
            (body.walletAddress && body.sessionId ? await requireAppSession(body.walletAddress, body.sessionId) : null);

        if (!authed) {
            return NextResponse.json({ error: 'Unauthorized: valid app session required' }, { status: 401 });
        }

        const limit = checkRateLimit(rateKey('clans:post', authed), 10, 60_000);
        if (!limit.ok) {
            return NextResponse.json(
                { error: 'Too many clan creation attempts', retryAfter: limit.retryAfterSec },
                { status: 429, headers: rateLimitHeaders(limit) },
            );
        }

        const { name, tag, bio, crest, txHash } = body;
        if (!name || !tag) {
            return NextResponse.json({ error: 'Clan name and tag are required' }, { status: 400 });
        }

        const { clanId } = await createClan({
            leaderWallet: authed,
            name,
            tag,
            bio,
            crest,
            txHash,
        });

        return NextResponse.json({ success: true, clanId });
    } catch (err: any) {
        if (err instanceof ClanServiceError) {
            return NextResponse.json({ error: err.message, code: err.code }, { status: err.statusCode });
        }
        console.error('[clans:POST]', err);
        return NextResponse.json({ error: err.message || 'Failed to create clan' }, { status: 500 });
    }
}
