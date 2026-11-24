/* eslint-disable @typescript-eslint/no-explicit-any -- lint burn-down quarantine 2026-09-23 */
import { useMemo, useEffect } from 'react';
import { PlayerColor } from '@/lib/types';
import { Corner, ColorCorner } from '@/lib/boardLayout';
import { Player } from '@/hooks/useGameEngine';
import { supabase } from '@/lib/supabase';
import { calculateLevel } from '@/lib/progression';

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

    // 2. Real Profile Syncing (batch-fetch all human seats in the roster)
    const walletKey = useMemo(() => {
        const set = new Set<string>();
        if (address) set.add(address.toLowerCase());
        for (const p of players) {
            if (!p.isAi && p.walletAddress) set.add(p.walletAddress.toLowerCase());
        }
        return Array.from(set).sort().join(',');
    }, [address, players]);

    useEffect(() => {
        if (!walletKey) return;
        let cancelled = false;
        const wallets = walletKey.split(',').filter(Boolean);
        const myAddrLower = address?.toLowerCase();

        const syncRosterProfiles = async () => {
            try {
                const { data, error } = await supabase
                    .from('players')
                    .select('wallet_address, username, avatar_url, lxp, rxp')
                    .in('wallet_address', wallets);

                if (cancelled || error || !data || data.length === 0) return;

                const byWallet = new Map<string, (typeof data)[number]>();
                for (const row of data) {
                    if (row.wallet_address) {
                        byWallet.set(String(row.wallet_address).toLowerCase(), row);
                    }
                }

                setBoardConfig((prev: any) => ({
                    ...prev,
                    players: prev.players.map((p: Player) => {
                        if (p.isAi) return p;
                        const lookupAddr =
                            p.walletAddress?.toLowerCase() ||
                            (p.name === 'Alex' && myAddrLower ? myAddrLower : undefined);
                        if (!lookupAddr) return p;
                        const row = byWallet.get(lookupAddr);
                        if (!row) return p;
                        const newLevel = calculateLevel(row.lxp || 0).level;
                        return {
                            ...p,
                            name: row.username || p.name,
                            avatar: row.avatar_url || p.avatar,
                            walletAddress: lookupAddr,
                            level: Math.max(p.level || 1, newLevel),
                            lxp: row.lxp ?? p.lxp,
                            rxp: row.rxp ?? p.rxp,
                        };
                    }),
                }));
            } catch (err) {
                console.error('Board: Profile sync failed', err);
            }
        };

        void syncRosterProfiles();
        return () => {
            cancelled = true;
        };
    }, [walletKey, address, setBoardConfig]);

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
