/**
 * N4 — TTL + LRU-bounded dedup store with eviction counter.
 * Replaces unbounded Set for processedIntentIds / processedActionIds.
 */

import { bumpNet } from './counters';

export type DedupOptions = {
    /** Max entries before LRU eviction. */
    max?: number;
    /** Entry TTL in ms (default 10 min). */
    ttlMs?: number;
    /** Called when an entry is evicted (TTL or LRU). */
    onEvict?: (id: string, reason: 'ttl' | 'lru') => void;
    /** Minimum ms between full TTL sweeps (default 30s). Head-only expiry
     * runs every call; the full sweep only reclaims entries stranded behind
     * a fresh head. */
    sweepIntervalMs?: number;
};

export type DedupStore = {
    /** True if id was already present (duplicate). */
    has: (id: string, now?: number) => boolean;
    /** Record id; returns true if it was already present (dup). */
    add: (id: string, now?: number) => boolean;
    size: () => number;
    evictions: () => number;
    clear: () => void;
};

export function createDedupStore(opts: DedupOptions = {}): DedupStore {
    const max = Math.max(1, opts.max ?? 512);
    const ttlMs = Math.max(0, opts.ttlMs ?? 10 * 60 * 1000);
    const sweepIntervalMs = Math.max(0, opts.sweepIntervalMs ?? 30_000);
    /** Map preserves insertion order — used as LRU (re-insert on touch). */
    const map = new Map<string, number>();
    let evicted = 0;
    let lastSweep = -Infinity;

    function drop(id: string, reason: 'ttl' | 'lru'): void {
        map.delete(id);
        evicted += 1;
        opts.onEvict?.(id, reason);
    }

    function purgeExpired(now: number): void {
        // NET-23: amortized expiry. A full O(n) scan on every has()/add() is
        // O(n²) under an intent flood (20.5ms for 5,000 calls at n=512).
        // The head of the insertion-ordered map is the oldest untouched entry,
        // so expired heads are collected every call in amortized O(1) — each
        // entry is removed once. Entries stranded behind a refreshed head are
        // reclaimed by a throttled full sweep. Presence (not absence) is what
        // has() reports, so lazy reclaim never flips a dup to new early:
        // worst case an expired id reads dup a little longer, the safe side.
        while (true) {
            const head = map.keys().next();
            if (head.done) break;
            const t = map.get(head.value);
            if (t === undefined || now - t <= ttlMs) break;
            drop(head.value, 'ttl');
        }
        if (now - lastSweep >= sweepIntervalMs) {
            lastSweep = now;
            for (const [id, t] of map) {
                if (now - t > ttlMs) drop(id, 'ttl');
            }
        }
    }

    function evictLru(): void {
        const oldest = map.keys().next();
        if (!oldest.done) {
            map.delete(oldest.value);
            evicted += 1;
            opts.onEvict?.(oldest.value, 'lru');
        }
    }

    return {
        has(id, now = Date.now()) {
            purgeExpired(now);
            return map.has(id);
        },
        add(id, now = Date.now()) {
            purgeExpired(now);
            if (map.has(id)) {
                // refresh LRU position
                map.delete(id);
                map.set(id, now);
                return true;
            }
            map.set(id, now);
            while (map.size > max) evictLru();
            return false;
        },
        size() {
            return map.size;
        },
        evictions() {
            return evicted;
        },
        clear() {
            map.clear();
        },
    };
}

/** Wire helper — meter dup/drop consistently. */
export function rememberIntent(store: DedupStore, id: string | undefined): 'new' | 'dup' | 'skip' {
    if (!id) return 'skip';
    const dup = store.add(id);
    if (dup) {
        bumpNet('net_intent_dup');
        return 'dup';
    }
    bumpNet('net_intent_ok');
    return 'new';
}
