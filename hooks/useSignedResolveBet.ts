"use client";

import { useCallback } from 'react';
import { buildBetResolveMessage } from '@/lib/matchProof';

type SignMessageAsync = (args: { account: `0x${string}`; message: string }) => Promise<string>;

/**
 * Host-signed spectator bet settlement. Edge verifies signature +
 * live_matches.host_address before calling settle_match_bets.
 */
export function useSignedResolveBet(opts: {
    isHost: boolean;
    myAddress: string | undefined;
    signMessageAsync: SignMessageAsync;
}) {
    const { isHost, myAddress, signMessageAsync } = opts;

    const resolveBet = useCallback(async (matchId: string, result: string, betType: string) => {
        if (!isHost || !myAddress) return;
        console.log('🎰 [Host] Triggering signed bet resolution:', { matchId, result, betType });
        try {
            const issuedAt = new Date().toISOString();
            const message = buildBetResolveMessage({
                matchId,
                result: String(result),
                betType,
                hostAddress: myAddress,
                issuedAt,
            });
            const signature = await signMessageAsync({ account: myAddress as `0x${string}`, message });
            const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/resolve-bet`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`
                },
                body: JSON.stringify({
                    matchId,
                    result: String(result),
                    betType,
                    hostAddress: myAddress,
                    message,
                    signature,
                    issuedAt,
                })
            });
            const data = await res.json();
            if (!res.ok) console.error('🎰 [Host] resolve-bet rejected', data);
            else console.log('🎰 [Host] resolve-bet ok', data);
        } catch (err) {
            console.error('🎰 [Host] resolve-bet failed', err);
        }
    }, [isHost, myAddress, signMessageAsync]);

    return resolveBet;
}
