import { NextResponse } from 'next/server';
import { relaySettlePool } from '@/lib/poolRelayer';
import { requireAppSession, requireSessionWallet } from '@/lib/serverAuth';
import type { Address, Hex } from 'viem';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const {
            walletAddress,
            sessionId,
            poolId,
            plan,
            deadline,
            nonce,
            hostSig,
            edgeSig,
            winnerAddresses,
            participants,
        } = body ?? {};

        const wallet =
            (await requireSessionWallet(request, { scope: 'app', expectedWallet: walletAddress })) ||
            (walletAddress && sessionId ? await requireAppSession(walletAddress, sessionId) : null);

        if (!wallet) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
        if (!poolId || !Array.isArray(plan) || !deadline || !nonce || !edgeSig) {
            return NextResponse.json({ error: 'Missing settle parameters' }, { status: 400 });
        }

        const payoutPlan = plan.map((p: { addr: Address; amount: string | bigint }) => ({
            addr: p.addr,
            amount: BigInt(p.amount),
        }));

        const tx = await relaySettlePool({
            poolId: poolId as Hex,
            payoutPlan,
            deadline: BigInt(deadline),
            nonce: BigInt(nonce),
            hostSig: (hostSig || '0x') as Hex,
            edgeSig: edgeSig as Hex,
            winnerAddresses: winnerAddresses as Address[],
            participants: participants as Address[],
        });

        if (!tx) {
            return NextResponse.json({ error: 'Relay settlement failed' }, { status: 500 });
        }

        return NextResponse.json({ success: true, tx });
    } catch (err: unknown) {
        console.error('[settle/relay] error:', err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : 'relay settlement failed' },
            { status: 500 },
        );
    }
}
