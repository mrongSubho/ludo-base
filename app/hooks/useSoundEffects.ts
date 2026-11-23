'use client';

import { useCallback, useEffect } from 'react';
import { usePreferences } from '@/hooks/usePreferences';
import { getSoundEngine } from '@/lib/audio/SoundEngine';
import type { SoundId, SoundPlayOptions } from '@/lib/audio/types';

export const useSoundEffects = () => {
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

    const playHover = useCallback(() => getSoundEngine().play('ui_hover'), []);
    const playClick = useCallback(() => getSoundEngine().play('ui_click'), []);
    const playSelect = useCallback(() => getSoundEngine().play('ui_select'), []);
    const playCoin = useCallback(() => getSoundEngine().play('coin_chink'), []);
    const playDiceRoll = useCallback(
        () => getSoundEngine().play('dice_roll', { diceStyle: preferences.diceStyle }),
        [preferences.diceStyle],
    );
    const playDiceLand = useCallback(
        () => getSoundEngine().play('dice_land', { diceStyle: preferences.diceStyle }),
        [preferences.diceStyle],
    );

    return {
        playHover,
        playClick,
        playSelect,
        playCoin,
        playDiceRoll,
        playDiceLand,
        playSfx,
    };
};
