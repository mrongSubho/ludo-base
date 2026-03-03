import { supabase } from '@/lib/supabase';

/**
 * Records a match result and updates the winner's statistics.
 * 
 * @param winnerAddress - The wallet address of the winner.
 * @param roomCode - The unique code for the game room.
 * @param gameMode - The mode of the game played (e.g., 'classic', 'power').
 * @param participants - List of wallet addresses of all participants.
 */
export async function recordMatchResult(
    winnerAddress: string,
    roomCode: string,
    gameMode: string,
    participants: string[]
) {
    console.log('📝 Recording match result...', { winnerAddress, roomCode, gameMode, participants });

    try {
        // A) Insert the match into the 'matches' table
        const { error: matchError } = await supabase.from('matches').insert({
            winner_address: winnerAddress,
            room_code: roomCode,
            game_mode: gameMode,
            participants
        });

        if (matchError) {
            console.error('❌ Error inserting match:', matchError);
            return { success: false, error: matchError };
        }

        // B) Update the winner's stats in the 'players' table
        // Fetch current stats
        const { data: player, error: fetchError } = await supabase
            .from('players')
            .select('total_wins, total_games')
            .ilike('wallet_address', winnerAddress)
            .single();

        if (fetchError) {
            console.error('❌ Error fetching player stats:', fetchError);
            // We don't return here because the match was still recorded
        } else {
            const newWins = (player?.total_wins || 0) + 1;
            const newGames = (player?.total_games || 0) + 1;

            // Update row
            const { error: updateError } = await supabase
                .from('players')
                .update({
                    total_wins: newWins,
                    total_games: newGames,
                    last_played_at: new Date().toISOString()
                })
                .ilike('wallet_address', winnerAddress);

            if (updateError) {
                console.error('❌ Error updating player stats:', updateError);
            }
        }

        // Also update total_games for all other participants
        const otherParticipants = participants.filter(p => p !== winnerAddress);
        for (const addr of otherParticipants) {
            const { data: otherPlayer, error: otherFetchError } = await supabase
                .from('players')
                .select('total_games')
                .ilike('wallet_address', addr)
                .single();

            if (!otherFetchError && otherPlayer) {
                await supabase
                    .from('players')
                    .update({
                        total_games: (otherPlayer.total_games || 0) + 1,
                        last_played_at: new Date().toISOString()
                    })
                    .ilike('wallet_address', addr);
            }
        }

        return { success: true };
    } catch (err) {
        console.error('❌ Unexpected error recording match result:', err);
        return { success: false, error: err };
    }
}
