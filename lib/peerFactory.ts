/**
 * PeerJS factory.
 *
 * Next 16/Turbopack's bundled `peerjs` can reserve a broker id and never
 * fire `open` (signaling stuck). Load a known-good ESM build at runtime;
 * fall back to the npm package if the CDN is blocked.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export type PeerLike = {
    on: (event: string, cb: (...args: any[]) => void) => void;
    connect: (id: string, opts?: Record<string, unknown>) => {
        on: (event: string, cb: (...args: any[]) => void) => void;
        send: (data: unknown) => void;
        close: () => void;
        open: boolean;
        peer: string;
    };
    destroy: () => void;
    reconnect: () => void;
    destroyed: boolean;
};

type PeerCtor = new (id?: string, opts?: Record<string, unknown>) => PeerLike;

let cached: PeerCtor | null = null;
let loading: Promise<PeerCtor> | null = null;

async function loadCtor(): Promise<PeerCtor> {
    try {
        const dynamicImport = new Function('u', 'return import(u)') as (u: string) => Promise<any>;
        const mod: any = await dynamicImport('https://esm.sh/peerjs@1.5.4');
        const Ctor = (mod?.default ?? mod) as PeerCtor;
        if (typeof Ctor === 'function') {
            console.log('peerFactory: using esm.sh peerjs');
            return Ctor;
        }
    } catch (e) {
        console.warn('peerFactory: CDN peerjs failed, falling back to npm', e);
    }
    const bundled: any = await import('peerjs');
    console.log('peerFactory: using bundled peerjs');
    return ((bundled?.default ?? bundled) as PeerCtor);
}

export async function createPeerInstance(id?: string): Promise<PeerLike> {
    (globalThis as { __peerFactoryUsed?: boolean }).__peerFactoryUsed = true;
    if (!cached) {
        if (!loading) loading = loadCtor();
        cached = await loading;
    }
    const inst = id ? new cached(id) : new cached();
    (globalThis as { __peerFactoryId?: string }).__peerFactoryId = id || '(random)';
    return inst;
}
