'use client';

// ─── Guest Pass ─────────────────────────────────────────────────────────────
// Wallet-free trial identity. Guests get a local `guest_xxxxxx` id that flows
// through the same `address` slot as a wallet, so UI code keeps working while
// every backend write stays walled behind `requireWallet` (see GuestWall).
// No Supabase row is ever created for a guest id.

const GUEST_ID_KEY = 'ludo-guest-id';
const GUEST_ACTIVE_KEY = 'ludo-guest-active';

/** Broadcast when the guest session changes (enter/exit/migrate). */
export const GUEST_EVENT = 'ludo-guest-change';

function notify() {
    try {
        window.dispatchEvent(new Event(GUEST_EVENT));
    } catch {
        /* non-browser — no listeners */
    }
}

function randomId(): string {
    try {
        const bytes = new Uint8Array(3);
        crypto.getRandomValues(bytes);
        return `guest_${Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')}`;
    } catch {
        return `guest_${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')}`;
    }
}

/** Pending guest id (kept after exit so the stash can migrate on connect). */
export function getGuestId(): string | null {
    try {
        return localStorage.getItem(GUEST_ID_KEY);
    } catch {
        return null;
    }
}

export function isGuestActive(): boolean {
    try {
        return localStorage.getItem(GUEST_ACTIVE_KEY) === '1' && !!localStorage.getItem(GUEST_ID_KEY);
    } catch {
        return false;
    }
}

/** Start (or resume) a guest session. Returns the guest id. */
export function enterGuest(): string {
    let id: string | null = null;
    try {
        id = localStorage.getItem(GUEST_ID_KEY);
        if (!id) {
            id = randomId();
            localStorage.setItem(GUEST_ID_KEY, id);
        }
        localStorage.setItem(GUEST_ACTIVE_KEY, '1');
    } catch {
        id = id ?? randomId();
    }
    notify();
    return id;
}

/** Leave guest mode (keeps the id so the stash can migrate on wallet connect). */
export function exitGuest(): void {
    try {
        localStorage.removeItem(GUEST_ACTIVE_KEY);
    } catch {
        /* storage unavailable */
    }
    notify();
}

/** Drop all guest state (after a successful stash migration). */
export function clearGuest(): void {
    try {
        localStorage.removeItem(GUEST_ACTIVE_KEY);
        localStorage.removeItem(GUEST_ID_KEY);
    } catch {
        /* storage unavailable */
    }
    notify();
}

// ─── Walled actions ─────────────────────────────────────────────────────────

export type WallAction =
    | 'online-play'
    | 'teamup'
    | 'market-buy'
    | 'arena-claim'
    | 'friend-add'
    | 'poke'
    | 'dm';

export const WALL_COPY: Record<WallAction, { title: string; body: string; unlock: string }> = {
    'online-play': {
        title: 'Online arenas need a wallet',
        body: 'Guest passes cover practice matches against bots. Real opponents, live tables, and ranked play need an onchain identity.',
        unlock: 'Matchmaking, live tables & ranked play',
    },
    teamup: {
        title: 'Team Up needs a wallet',
        body: 'Private lobbies, room codes, and invites are tied to your onchain identity so friends can find you.',
        unlock: 'Private lobbies, room codes & invites',
    },
    'market-buy': {
        title: 'The vault needs a wallet',
        body: 'You can browse and inspect everything, but trial coins aren\'t real. Connect to buy for keeps.',
        unlock: 'Real coins, purchases & tradable vault',
    },
    'arena-claim': {
        title: 'Rewards need a wallet',
        body: 'Missions track while you play, but claiming rewards pays to an onchain identity.',
        unlock: 'Mission rewards & tournament entry',
    },
    'friend-add': {
        title: 'Friends need a wallet',
        body: 'Friend lists are spam-proofed onchain. Connect so other players can find and trust you.',
        unlock: 'Friends, requests & trust graph',
    },
    poke: {
        title: 'Pokes need a wallet',
        body: 'Pokes pay coin rewards, so they only flow between onchain identities.',
        unlock: 'Pokes, coin rewards & social play',
    },
    dm: {
        title: 'Messages need a wallet',
        body: 'DMs are encrypted between onchain identities. Connect to start conversations.',
        unlock: 'Encrypted DMs & P2P chat',
    },
};

// ─── Stash migration ────────────────────────────────────────────────────────
// Guest-owned marketplace SKUs + showcased relic live in wallet-keyed
// localStorage. On first wallet connect we copy them over once, so trial
// finds come along. Prefs are device-wide already — nothing to migrate.

const migratedKeyFor = (guestId: string) => `ludo-guest-migrated-${guestId.toLowerCase()}`;

export function migrateGuestStash(guestId: string, wallet: string): boolean {
    try {
        const g = guestId.toLowerCase();
        const w = wallet.toLowerCase();
        if (!g || !w || g === w) return false;
        if (localStorage.getItem(migratedKeyFor(g)) === '1') return false;

        const invSrc = localStorage.getItem(`ludo-inventory-${g}`);
        if (invSrc) {
            const dstKey = `ludo-inventory-${w}`;
            const merge = (a: string | null, b: string | null): string => {
                const out = new Set<string>();
                for (const raw of [a, b]) {
                    if (!raw) continue;
                    try {
                        const arr = JSON.parse(raw);
                        if (Array.isArray(arr)) arr.forEach(s => { if (typeof s === 'string') out.add(s); });
                    } catch {
                        /* keep what parses */
                    }
                }
                return JSON.stringify([...out]);
            };
            localStorage.setItem(dstKey, merge(localStorage.getItem(dstKey), invSrc));
        }

        const showcaseSrc = localStorage.getItem(`ludo-showcase-${g}`);
        if (showcaseSrc && !localStorage.getItem(`ludo-showcase-${w}`)) {
            localStorage.setItem(`ludo-showcase-${w}`, showcaseSrc);
        }

        localStorage.setItem(migratedKeyFor(g), '1');
        clearGuest();
        return true;
    } catch {
        return false;
    }
}
