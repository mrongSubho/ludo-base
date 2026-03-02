"use client";

import { useEffect, ReactNode } from 'react';
import sdk from '@farcaster/frame-sdk';

export default function FrameProvider({ children }: { children: ReactNode }) {
    useEffect(() => {
        const init = async () => {
            console.log('🎬 Initializing Farcaster Frame SDK...');
            try {
                await sdk.actions.ready();
                console.log('✅ Farcaster Frame SDK Ready');
            } catch (error) {
                console.error('❌ Farcaster Frame SDK Initialization Error:', error);
            }
        };

        init();
    }, []);

    return <>{children}</>;
}
