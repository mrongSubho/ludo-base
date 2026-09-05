'use client';

import React, { createContext, useCallback, useContext, useState } from 'react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { exitGuest, WallAction } from '@/lib/guest';
import GuestWall from '@/app/components/GuestWall';

interface GuestWallContextType {
    /**
     * Run `fn` only for wallet users. Guests see the wall popup instead and
     * `fn` never runs. Returns true when `fn` ran.
     */
    guard: (action: WallAction, fn?: () => void) => boolean;
    showWall: (action: WallAction) => void;
    closeWall: () => void;
}

const GuestWallContext = createContext<GuestWallContextType | undefined>(undefined);

export function GuestWallProvider({ children }: { children: React.ReactNode }) {
    const { isGuest } = useCurrentUser();
    const [wall, setWall] = useState<WallAction | null>(null);

    const showWall = useCallback((action: WallAction) => setWall(action), []);
    const closeWall = useCallback(() => setWall(null), []);

    const guard = useCallback((action: WallAction, fn?: () => void) => {
        if (isGuest) {
            setWall(action);
            return false;
        }
        fn?.();
        return true;
    }, [isGuest]);

    const handleConnect = useCallback(() => {
        // Back to the entrance: wallet connect happens there, and the guest
        // stash migrates on first connect (see useCurrentUser).
        setWall(null);
        exitGuest();
    }, []);

    return (
        <GuestWallContext.Provider value={{ guard, showWall, closeWall }}>
            {children}
            {wall && (
                <GuestWall action={wall} onClose={closeWall} onConnect={handleConnect} />
            )}
        </GuestWallContext.Provider>
    );
}

export function useGuestWall(): GuestWallContextType {
    const ctx = useContext(GuestWallContext);
    if (!ctx) throw new Error('useGuestWall must be used within a GuestWallProvider');
    return ctx;
}
