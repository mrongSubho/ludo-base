import { NextResponse } from 'next/server';

/**
 * POST /api/missions/claim — RETIRED.
 *
 * This endpoint credited `players.coins`, a legacy currency frozen by
 * 202609300001_freeze_legacy_coin_writers.sql. Because the trigger raises on any
 * `coins` mutation, the handler flipped `player_missions.is_claimed` to true and
 * *then* failed on the coin write — so missions became permanently unclaimable
 * while appearing claimed (SYSTEM_REVIEW.md SEC-09).
 *
 * CHIPS rewards are issued through the EIP-712 MissionClaim voucher path:
 *   POST /api/missions/voucher   { walletAddress, sessionId, missionId, chainId? }
 * Rewards and targets are read from `mission_catalog` server-side.
 *
 * Kept as an explicit 410 rather than deleted so an older client gets an
 * actionable answer instead of a 404.
 */
export async function POST() {
    return NextResponse.json(
        {
            error: 'Coin mission rewards have been retired.',
            migratedTo: '/api/missions/voucher',
            currency: 'CHIPS',
        },
        { status: 410 },
    );
}
