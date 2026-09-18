"use client";

import { useEffect, useState } from 'react';

/** True on phone-width viewports (and tablets in portrait). */
export function useIsMobileView(breakpoint = 768): boolean {
    const [mobile, setMobile] = useState(false);
    useEffect(() => {
        const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
        const apply = () => setMobile(mq.matches);
        apply();
        mq.addEventListener('change', apply);
        return () => mq.removeEventListener('change', apply);
    }, [breakpoint]);
    return mobile;
}
