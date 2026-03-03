/**
 * Records a match result and updates the winner's statistics via the secure API.
 */
export async function recordMatchResult(
    winnerAddress: string,
    roomCode: string,
    gameMode: string,
    participants: string[]
) {
    console.log('📡 [MatchRecorder] Sending request to secure API...', { winnerAddress, roomCode, gameMode, participants });

    try {
        const response = await fetch('/api/match/record', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                winnerAddress,
                roomCode,
                gameMode,
                participants
            }),
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('❌ [MatchRecorder] API Error:', data.error);
            return { success: false, error: data.error };
        }

        return { success: true };
    } catch (err) {
        console.error('❌ [MatchRecorder] Network error:', err);
        return { success: false, error: err };
    }
}
