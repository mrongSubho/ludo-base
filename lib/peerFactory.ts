/**
 * PeerJS factory — npm-pinned only. **No CDN / esm.sh in the prod path.**
 *
 * Next 16/Turbopack has historically reserved broker ids and hung `open`
 * with certain bundlings. We pin `peerjs@1.5.5` from package.json and load
 * it via a single entrypoint so hosts/guests/chat share one construction path.
 *
 * Optional self-hosted PeerServer (signaling ownership spike — docs/ops/SIGNALING.md):
 *   NEXT_PUBLIC_PEERJS_HOST=peer.example.com
 *   NEXT_PUBLIC_PEERJS_PORT=443
 *   NEXT_PUBLIC_PEERJS_PATH=/ludo
 *   NEXT_PUBLIC_PEERJS_KEY=ludo
 *   NEXT_PUBLIC_PEERJS_SECURE=1
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
    id?: string;
};

export type PeerCtor = new (id?: string, opts?: Record<string, unknown>) => PeerLike;

export type PeerFactoryConfig = {
    host?: string;
    port?: number;
    path?: string;
    key?: string;
    secure?: boolean;
    debug?: number | false;
    config?: { iceServers?: Array<Record<string, unknown>> };
};

let cached: PeerCtor | null = null;
let loading: Promise<PeerCtor> | null = null;

/** PeerServer config from env (empty → peerjs.com cloud default). */
export function peerServerConfig(): PeerFactoryConfig {
    const host = process.env.NEXT_PUBLIC_PEERJS_HOST;
    if (!host) {
        return {
            debug: 1,
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:global.stun.twilio.com:3478?transport=udp' },
                ],
            },
        };
    }
    const port = Number(process.env.NEXT_PUBLIC_PEERJS_PORT || 443);
    const secure = process.env.NEXT_PUBLIC_PEERJS_SECURE !== '0';
    return {
        host,
        port,
        path: process.env.NEXT_PUBLIC_PEERJS_PATH || '/',
        key: process.env.NEXT_PUBLIC_PEERJS_KEY || 'ludo',
        secure,
        debug: 1,
        config: {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:global.stun.twilio.com:3478?transport=udp' },
            ],
        },
    };
}

async function loadCtor(): Promise<PeerCtor> {
    // Pinned npm build only — never esm.sh / unpkg / jspm in production.
    const bundled: any = await import('peerjs');
    const Ctor = ((bundled?.default ?? bundled) as PeerCtor);
    if (typeof Ctor !== 'function') {
        throw new Error('peerjs export is not a constructor');
    }
    (globalThis as { __peerJsSource?: string }).__peerJsSource = 'npm:peerjs';
    console.log('peerFactory: using pinned npm peerjs');
    return Ctor;
}

export async function getPeerCtor(): Promise<PeerCtor> {
    if (!cached) {
        if (!loading) loading = loadCtor();
        cached = await loading;
    }
    return cached;
}

export async function createPeerInstance(id?: string, extraOpts?: PeerFactoryConfig): Promise<PeerLike> {
    (globalThis as { __peerFactoryUsed?: boolean }).__peerFactoryUsed = true;
    const Ctor = await getPeerCtor();
    const opts = { ...peerServerConfig(), ...extraOpts };
    const inst = id ? new Ctor(id, opts) : new Ctor(undefined, opts);
    (globalThis as { __peerFactoryId?: string }).__peerFactoryId = id || '(random)';
    (globalThis as { __peerJsSource?: string }).__peerJsSource = 'npm:peerjs';
    return inst;
}

/** Test helper — reset module cache. */
export function resetPeerFactoryForTests(): void {
    cached = null;
    loading = null;
}
