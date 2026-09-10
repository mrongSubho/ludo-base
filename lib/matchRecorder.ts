/**
 * Records a match result and updates the winner's statistics via the secure API.
 * The caller must wallet-sign the canonical payload; the API verifies the signature.
 */
import { buildMatchRecordMessage } from './matchProof';

export type SignMessageFn = (message: string) => Promise<string>;

export async function recordMatchResult(
    winnerAddress: string | null,
    roomCode: string,
    gameMode: string,
    participants: string[],
    matchId: string | undefined,
    signMessage: SignMessageFn
) {
    const issuedAt = new Date().toISOString();
    const wager = 0; // coin awards from this path are XP/history only; wager pot is separate
    const message = buildMatchRecordMessage({
        winnerAddress,
        roomCode,
        gameMode,
        participants,
        wager,
        matchId: matchId || null,
        issuedAt,
    });

    console.log('📡 [MatchRecorder] Sending signed request...', { winnerAddress, roomCode, gameMode, participants, matchId });

    try {
        const signature = await signMessage(message);

        const response = await fetch('/api/match/record', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                winnerAddress,
                roomCode,
                gameMode,
                participants,
                matchId,
                wager,
                message,
                signature,
                issuedAt,
            }),
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('❌ [MatchRecorder] API Error:', data.error);
            return { success: false, error: data.error };
        }

        return { success: true };
    } catch (err) {
        console.error('❌ [MatchRecorder] Network/signing error:', err);
        return { success: false, error: err };
    }
}
