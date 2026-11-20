import { NextResponse } from 'next/server';
import { requireSessionWallet, serviceDb } from '@/lib/serverAuth';
import { getClanTagsForWallets } from '@/lib/clan/clanService';

const BASE_PUBLIC_COLS =
    'wallet_address, username, avatar_url, lxp, rxp, status, classic_played, power_played, ai_played, total_wins, total_games, rank_tier, last_played_at, created_at';

/**
 * GET /api/profile/public?walletAddress=0x…
 * Read-only pilot dossier lookup. Enforces `is_public = false` against
 * non-friend, non-self viewers by redacting telemetry & match logs, and
 * enriches the identity card with the pilot's clan tag.
 */
export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const rawWallet = (searchParams.get('walletAddress') || '').trim();
        if (!/^0x[a-fA-F0-9]{40}$/.test(rawWallet)) {
            return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 });
        }
        const target = rawWallet.toLowerCase();

        const viewer = await requireSessionWallet(request, { scope: 'app' }).catch(() => null);
        const viewerLower = viewer ? viewer.toLowerCase() : null;
        const isSelf = !!viewerLower && viewerLower === target;

        const db = serviceDb();
        let { data: player, error } = await db
            .from('players')
            .select(`${BASE_PUBLIC_COLS}, is_public, allow_requests`)
            .ilike('wallet_address', target)
            .maybeSingle();

        // Fallback if privacy columns haven't been migrated yet
        if (error && /is_public|allow_requests|column/i.test(error.message)) {
            const fallback = await db
                .from('players')
                .select(BASE_PUBLIC_COLS)
                .ilike('wallet_address', target)
                .maybeSingle();
            if (fallback.error) {
                return NextResponse.json({ error: fallback.error.message }, { status: 500 });
            }
            player = fallback.data
                ? { ...fallback.data, is_public: true, allow_requests: true }
                : null;
            error = null;
        }

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        let isFriend = false;
        if (viewerLower && !isSelf) {
            const [fwd, rev] = await Promise.all([
                db
                    .from('friendships')
                    .select('status')
                    .eq('user_address', viewerLower)
                    .eq('friend_address', target)
                    .eq('status', 'accepted')
                    .maybeSingle(),
                db
                    .from('friendships')
                    .select('status')
                    .eq('user_address', target)
                    .eq('friend_address', viewerLower)
                    .eq('status', 'accepted')
                    .maybeSingle(),
            ]);
            isFriend = !!(fwd.data || rev.data);
        }

        const clanMap = await getClanTagsForWallets([target]);
        const clanInfo = clanMap[target];

        if (!player) {
            return NextResponse.json({
                profile: {
                    wallet_address: target,
                    username: null,
                    avatar_url: null,
                    lxp: 0,
                    rxp: 0,
                    status: 'Offline',
                    classic_played: 0,
                    power_played: 0,
                    ai_played: 0,
                    total_wins: 0,
                    total_games: 0,
                    rank_tier: 'Bronze',
                    last_played_at: null,
                    created_at: null,
                    is_public: true,
                    allow_requests: true,
                    clan_tag: clanInfo?.tag ?? null,
                    clan_id: clanInfo?.clanId ?? null,
                    clan_name: clanInfo?.name ?? null,
                    private_redacted: false,
                },
                recentMatches: [],
            });
        }

        const isPublic = player.is_public !== false;
        const allowRequests = player.allow_requests !== false;
        const privateRedacted = !isPublic && !isSelf && !isFriend;

        if (privateRedacted) {
            return NextResponse.json({
                profile: {
                    wallet_address: player.wallet_address,
                    username: player.username,
                    avatar_url: player.avatar_url,
                    lxp: player.lxp ?? 0,
                    rxp: 0,
                    status: 'Offline',
                    classic_played: null,
                    power_played: null,
                    ai_played: null,
                    total_wins: null,
                    total_games: null,
                    rank_tier: player.rank_tier,
                    last_played_at: null,
                    created_at: player.created_at,
                    is_public: false,
                    allow_requests: allowRequests,
                    clan_tag: clanInfo?.tag ?? null,
                    clan_id: clanInfo?.clanId ?? null,
                    clan_name: clanInfo?.name ?? null,
                    private_redacted: true,
                },
                recentMatches: [],
            });
        }

        const { data: recentMatches } = await db
            .from('matches')
            .select('winner_address, created_at, game_mode')
            .overlaps('participants', [target, rawWallet])
            .order('created_at', { ascending: false })
            .limit(100);

        return NextResponse.json({
            profile: {
                ...player,
                is_public: isPublic,
                allow_requests: allowRequests,
                clan_tag: clanInfo?.tag ?? null,
                clan_id: clanInfo?.clanId ?? null,
                clan_name: clanInfo?.name ?? null,
                private_redacted: false,
            },
            recentMatches: recentMatches || [],
        });
    } catch (error) {
        return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
}
