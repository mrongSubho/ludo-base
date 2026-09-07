// Followed predictors: persisted per wallet, shared by the Sharpest strip
// (toggle) and the spectating HUD (mirror their open picks).

const keyFor = (me: string) => `ludo_follow_${me.toLowerCase()}`;

export function getFollowed(me: string | undefined): string[] {
    if (!me || typeof window === 'undefined') return [];
    try {
        const raw = localStorage.getItem(keyFor(me));
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
    } catch {
        return [];
    }
}

export function toggleFollow(me: string, playerId: string): string[] {
    const cur = getFollowed(me);
    const lower = playerId.toLowerCase();
    const next = cur.includes(lower) ? cur.filter(x => x !== lower) : [...cur, lower].slice(-20);
    try {
        localStorage.setItem(keyFor(me), JSON.stringify(next));
    } catch {
        /* storage unavailable */
    }
    return next;
}
