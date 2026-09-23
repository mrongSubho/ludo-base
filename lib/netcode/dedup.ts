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
    /** Map preserves insertion order — used as LRU (re-insert on touch). */
    const map = new Map<string, number>();
    let evicted = 0;

    function purgeExpired(now: number): void {
        for (const [id, t] of map) {
            if (now - t > ttlMs) {
                map.delete(id);
                evicted += 1;
                opts.onEvict?.(id, 'ttl');
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
