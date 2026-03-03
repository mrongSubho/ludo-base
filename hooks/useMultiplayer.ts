"use client";

import { useMultiplayerContext } from './MultiplayerContext';

export function useMultiplayer() {
    return useMultiplayerContext();
}
