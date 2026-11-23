'use client';

import { useCallback, useEffect } from 'react';
import { usePreferences } from '@/hooks/usePreferences';
import { getSoundEngine } from '@/lib/audio/SoundEngine';
import type { SoundId, SoundPlayOptions } from '@/lib/audio/types';

export const useAudio = () => {
    const { preferences } = usePreferences();

    useEffect(() => {
        getSoundEngine().updatePrefs({
            theme: preferences.theme,
            sfx: preferences.sfx,
            music: preferences.music,
            sfxVolume: preferences.sfxVolume,
            musicVolume: preferences.musicVolume,
            haptics: preferences.haptics,
        });
    }, [
        preferences.theme,
        preferences.sfx,
        preferences.music,
        preferences.sfxVolume,
        preferences.musicVolume,
        preferences.haptics,
    ]);

    const playSfx = useCallback((id: SoundId, opts?: SoundPlayOptions) => {
        getSoundEngine().play(id, opts);
    }, []);

    const triggerHaptic = useCallback((pattern: number | number[] = 10) => {
        getSoundEngine().triggerHaptic(pattern);
    }, []);

    const playMove = useCallback(() => {
        getSoundEngine().play('token_land');
    }, []);

    const playCapture = useCallback(() => {
        getSoundEngine().play('capture_kick');
    }, []);

    const playWin = useCallback(() => {
        getSoundEngine().play('match_victory');
    }, []);

    const stopAmbient = useCallback(() => {
        getSoundEngine().setMatchMood('silent', 0);
    }, []);

    const playAmbient = useCallback((theme: string) => {
        const engine = getSoundEngine();
        engine.updatePrefs({ theme });
        engine.unlock();
    }, []);

    const playTurn = useCallback(() => {
        getSoundEngine().play('turn_mine');
    }, []);

    const playStrike = useCallback(() => {
        getSoundEngine().play('afk_strike');
    }, []);

    const playNuke = useCallback(() => {
        getSoundEngine().play('power_nuke');
    }, []);

    const playShield = useCallback(() => {
        getSoundEngine().play('power_shield');
    }, []);

    const playBoost = useCallback(() => {
        getSoundEngine().play('power_boost');
    }, []);

    const playTeleport = useCallback(() => {
        getSoundEngine().play('power_teleport');
    }, []);

    const playPickup = useCallback(() => {
        getSoundEngine().play('power_pickup');
    }, []);

    return {
        playMove,
        playCapture,
        playWin,
        playAmbient,
        stopAmbient,
        playTurn,
        playStrike,
        triggerHaptic,
        playNuke,
        playShield,
        playBoost,
        playTeleport,
        playPickup,
        playSfx,
    };
};
