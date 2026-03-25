import { useMemo, useEffect } from 'react';
import { PlayerColor } from '@/lib/types';
import { Corner, ColorCorner } from '@/lib/boardLayout';
import { Player } from '@/hooks/useGameEngine';
import { supabase } from '@/lib/supabase';

const CORNER_ORDER: Corner[] = ['TL', 'TR', 'BR', 'BL'];

interface UseBoardLayoutProps {
    players: Player[];
    colorCorner: ColorCorner;
    address: string | undefined;
    participants: any;
    setBoardConfig: React.Dispatch<React.SetStateAction<any>>;
}

export function useBoardLayout({
    players,
    colorCorner,
    address,
    participants,
    setBoardConfig
}: UseBoardLayoutProps) {
    // 1. Visual Quadrant Algorithm
    const layout = useMemo(() => {
        const myAddrLower = address?.toLowerCase();
        const localPlayer = players.find(p => myAddrLower && p.walletAddress?.toLowerCase() === myAddrLower)
            || players.find(p => !p.isAi)
            || players[0];
            
        const localColor = localPlayer?.color as PlayerColor;
        const localServerCorner = (colorCorner && localColor) ? colorCorner[localColor] : 'BL';
        const localServerIndex = CORNER_ORDER.indexOf(localServerCorner as Corner);

        const TARGET_INDEX = 3; // BL (Bottom Left is usually the "Home" player visual)
        const rotationOffset = (TARGET_INDEX - localServerIndex + 4) % 4;

        const boardRotationDeg = rotationOffset * 90;
        const counterRotationDeg = boardRotationDeg !== 0 ? -boardRotationDeg : 0;

        const uiSlots: Record<string, PlayerColor | null> = { TL: null, TR: null, BL: null, BR: null };
        (Object.entries(colorCorner) as [PlayerColor, Corner][]).forEach(([color, serverCorner]) => {
            const serverIndex = CORNER_ORDER.indexOf(serverCorner);
            const visualIndex = (serverIndex + rotationOffset) % 4;
            const visualCorner = CORNER_ORDER[visualIndex];
            uiSlots[visualCorner] = color;
        });

        return { boardRotationDeg, counterRotationDeg, uiSlots };
    }, [colorCorner, players, address]);

    // 2. Real Profile Syncing
    useEffect(() => {
        const syncMyProfile = async () => {
            if (!address) return;

            try {
                const { data, error } = await supabase
                    .from('players')
                    .select('username, avatar_url, total_wins')
                    .eq('wallet_address', address.toLowerCase())
                    .single();

                if (data && !error) {
                    setBoardConfig((prev: any) => ({
                        ...prev,
                        players: prev.players.map((p: Player) => {
                            if (!p.isAi && (p.name === 'Alex' || p.walletAddress === address.toLowerCase())) {
                                return {
                                    ...p,
                                    name: data.username || p.name,
                                    avatar: data.avatar_url || p.avatar,
                                    walletAddress: address.toLowerCase(),
                                    level: Math.max(p.level, Math.floor((data.total_wins || 0) / 5) + 1)
                                };
                            }
                            return p;
                        })
                    }));
                }
            } catch (err) {
                console.error("Board: Profile sync failed", err);
            }
        };

        syncMyProfile();
    }, [address, setBoardConfig]);

    // 3. TeamUp Profile Sync
    useEffect(() => {
        if (!participants || Object.keys(participants).length === 0) return;

        setBoardConfig((prev: any) => ({
            ...prev,
            players: prev.players.map((p: Player) => {
                const pData = participants[p.walletAddress?.toLowerCase() || ''];
                if (pData) {
                    return {
                        ...p,
                        name: pData.username || p.name,
                        avatar: pData.avatar_url || p.avatar
                    };
                }
                return p;
            })
        }));
    }, [participants, setBoardConfig]);

    return layout;
}
