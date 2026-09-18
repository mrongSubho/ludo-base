"use client";

import { useEffect, ReactNode } from 'react';
import sdk from '@farcaster/frame-sdk';

/**
 * Host webviews (Coinbase Wallet, Base App, Farcaster) often:
 *  - report a layout viewport taller than the painted area
 *  - inject huge env(safe-area-inset-bottom) for toolbars that never render
 *  - pad <body>, leaving a blank band under the footer
 * We measure the real visual viewport + a safe-area probe and publish
 * --app-vh / --safe-bottom / --vv-dead-bottom for the shell + footer.
 */
export default function FrameProvider({ children }: { children: ReactNode }) {
    useEffect(() => {
        const init = async () => {
            try {
                await sdk.actions.ready();
            } catch {
                // Not inside a Farcaster/Base frame — browser is fine.
            }
        };
        init();

        const root = document.documentElement;

        const probe = document.createElement('div');
        probe.setAttribute('aria-hidden', 'true');
        probe.style.cssText =
            'position:fixed;left:0;bottom:0;width:0;height:env(safe-area-inset-bottom);visibility:hidden;pointer-events:none;z-index:-1';
        document.body.appendChild(probe);

        const apply = () => {
            const vv = window.visualViewport;
            const layoutH = window.innerHeight;
            const visH = vv ? vv.height : layoutH;
            const offsetTop = vv ? vv.offsetTop : 0;
            // Layout pixels below the painted visual viewport (host chrome).
            const deadBottom = Math.max(0, Math.round(layoutH - visH - offsetTop));
            // Empty webview toolbars report 80–200px insets; real home-indicator
            // insets are ≤48px. Anything above is host chrome we must not reserve.
            const rawSab = probe.getBoundingClientRect().height;
            const safeBottom = rawSab > 48 ? 0 : Math.round(rawSab);

            root.style.setProperty('--app-vh', `${Math.round(visH)}px`);
            root.style.setProperty('--safe-bottom', `${safeBottom}px`);
            root.style.setProperty('--vv-dead-bottom', `${deadBottom}px`);

            // Kill host-injected body padding that paints as a blank bottom band.
            document.body.style.paddingBottom = '0px';
            document.body.style.marginBottom = '0px';
            root.style.paddingBottom = '0px';
        };

        apply();
        const vv = window.visualViewport;
        vv?.addEventListener('resize', apply);
        vv?.addEventListener('scroll', apply);
        window.addEventListener('resize', apply);
        window.addEventListener('orientationchange', apply);
        // Hosts inject chrome asynchronously after ready().
        const t1 = window.setTimeout(apply, 250);
        const t2 = window.setTimeout(apply, 1200);
        const t3 = window.setTimeout(apply, 3000);
        const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(apply) : null;
        ro?.observe(document.body);

        return () => {
            vv?.removeEventListener('resize', apply);
            vv?.removeEventListener('scroll', apply);
            window.removeEventListener('resize', apply);
            window.removeEventListener('orientationchange', apply);
            window.clearTimeout(t1);
            window.clearTimeout(t2);
            window.clearTimeout(t3);
            ro?.disconnect();
            probe.remove();
        };
    }, []);

    return <>{children}</>;
}
