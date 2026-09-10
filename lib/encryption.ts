/**
 * Real ECDH (P-256) + HKDF + AES-GCM for DM ciphertext.
 *
 * Each identity owns a static ECDH keypair in localStorage and publishes the
 * public key on `players.ecdh_pubkey`. Messages use a sealed-box style:
 * sender generates an ephemeral pair, derives a shared secret with the
 * recipient's static public key, and ships `{ epk, iv, content }`.
 *
 * Legacy messages encrypted with the old wallet-hash scheme can still be
 * opened via `decryptLegacyMessage` until they age out.
 */

const CURVE = 'ECDH' as const;
const NAMED_CURVE = 'P-256' as const;
const STORAGE_PREFIX = 'ludo-ecdh-v1';

export interface SealedBox {
    /** Sender ephemeral public key (JWK) */
    epk: JsonWebKey;
    iv: string;
    content: string;
    /** 1 = ECDH sealed box */
    v: 1;
}

function storageKey(ownerId: string): string {
    return `${STORAGE_PREFIX}:${ownerId.toLowerCase()}`;
}

function b64encode(buf: ArrayBuffer | Uint8Array): string {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
}

function b64decode(s: string): Uint8Array {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

/** Load or create this identity's static ECDH keypair. */
export async function getOrCreateIdentityKey(ownerId: string): Promise<CryptoKeyPair> {
    const key = storageKey(ownerId);
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    if (raw) {
        try {
            const parsed = JSON.parse(raw) as { publicKey: JsonWebKey; privateKey: JsonWebKey };
            const publicKey = await crypto.subtle.importKey(
                'jwk', parsed.publicKey, { name: CURVE, namedCurve: NAMED_CURVE }, true, []
            );
            const privateKey = await crypto.subtle.importKey(
                'jwk', parsed.privateKey, { name: CURVE, namedCurve: NAMED_CURVE }, true, ['deriveBits']
            );
            return { publicKey, privateKey };
        } catch {
            // fall through and regenerate
        }
    }

    const pair = (await crypto.subtle.generateKey(
        { name: CURVE, namedCurve: NAMED_CURVE },
        true,
        ['deriveKey', 'deriveBits']
    )) as CryptoKeyPair;

    const publicKey = await crypto.subtle.exportKey('jwk', pair.publicKey);
    const privateKey = await crypto.subtle.exportKey('jwk', pair.privateKey);
    if (typeof localStorage !== 'undefined') {
        localStorage.setItem(key, JSON.stringify({ publicKey, privateKey }));
    }
    return pair;
}

/** Export static public key as JWK for publishing / wire. */
export async function exportPublicKeyJwk(ownerId: string): Promise<JsonWebKey> {
    const pair = await getOrCreateIdentityKey(ownerId);
    return crypto.subtle.exportKey('jwk', pair.publicKey);
}

export function isSealedBox(value: unknown): value is SealedBox {
    if (!value || typeof value !== 'object') return false;
    const v = value as SealedBox;
    return v.v === 1 && !!v.epk && typeof v.iv === 'string' && typeof v.content === 'string';
}

export function parseMessagePayload(content: string): SealedBox | { iv: string; content: string } | null {
    try {
        const parsed = JSON.parse(content);
        if (isSealedBox(parsed)) return parsed;
        if (parsed && typeof parsed.iv === 'string' && typeof parsed.content === 'string') {
            return parsed as { iv: string; content: string };
        }
        return null;
    } catch {
        return null;
    }
}

async function importPeerPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
    return crypto.subtle.importKey(
        'jwk',
        jwk,
        { name: CURVE, namedCurve: NAMED_CURVE },
        false,
        []
    );
}

async function deriveAesKey(priv: CryptoKey, pub: CryptoKey): Promise<CryptoKey> {
    const bits = await crypto.subtle.deriveBits(
        { name: CURVE, public: pub },
        priv,
        256
    );
    // HKDF-ish: hash the shared secret with a domain separator before AES import
    const salt = new TextEncoder().encode('ludo-dm-ecdh-v1');
    const combined = new Uint8Array(salt.length + bits.byteLength);
    combined.set(salt, 0);
    combined.set(new Uint8Array(bits), salt.length);
    const digest = await crypto.subtle.digest('SHA-256', combined);
    return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/**
 * Encrypt `text` for `recipientId` using a sealed box against their static pubkey.
 * `recipientPublicKeyJwk` must be fetched from `players.ecdh_pubkey` (or a peer).
 */
export async function encryptForPeer(
    senderId: string,
    recipientPublicKeyJwk: JsonWebKey,
    text: string
): Promise<SealedBox> {
    // Ensure sender has a static identity (for key continuity / future auth)
    await getOrCreateIdentityKey(senderId);

    const ephemeral = (await crypto.subtle.generateKey(
        { name: CURVE, namedCurve: NAMED_CURVE },
        true,
        ['deriveKey', 'deriveBits']
    )) as CryptoKeyPair;

    const peerPub = await importPeerPublicKey(recipientPublicKeyJwk);
    const aesKey = await deriveAesKey(ephemeral.privateKey, peerPub);

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new TextEncoder().encode(text);
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, data);
    const epk = await crypto.subtle.exportKey('jwk', ephemeral.publicKey);

    return {
        v: 1,
        epk,
        iv: b64encode(iv),
        content: b64encode(encrypted),
    };
}

/** Decrypt a sealed box using this identity's static private key. */
export async function decryptSealedBox(ownerId: string, box: SealedBox): Promise<string> {
    const pair = await getOrCreateIdentityKey(ownerId);
    const epk = await importPeerPublicKey(box.epk);
    const aesKey = await deriveAesKey(pair.privateKey, epk);
    const iv = b64decode(box.iv);
    const content = b64decode(box.content);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, content);
    return new TextDecoder().decode(decrypted);
}

// ─── Legacy (wallet-hash) — decrypt-only for old rows ───────────────────────

/** @deprecated Obfuscation only. Kept so historical DMs remain readable. */
export async function deriveSharedKey(walletA: string, walletB: string, salt = 'ludo-secret-salt-2024'): Promise<CryptoKey> {
    const ids = [walletA.toLowerCase(), walletB.toLowerCase()].sort();
    const combined = ids.join(':') + salt;
    const encoder = new TextEncoder();
    const data = encoder.encode(combined);
    const hash = await window.crypto.subtle.digest('SHA-256', data);
    return window.crypto.subtle.importKey('raw', hash, 'AES-GCM', true, ['encrypt', 'decrypt']);
}

export async function encryptMessage(text: string, key: CryptoKey): Promise<{ iv: string; content: string }> {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
    return {
        iv: b64encode(iv),
        content: b64encode(encrypted),
    };
}

export async function decryptMessage(encryptedData: { iv: string; content: string }, key: CryptoKey): Promise<string> {
    const iv = b64decode(encryptedData.iv);
    const content = b64decode(encryptedData.content);
    const decrypted = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, content);
    return new TextDecoder().decode(decrypted);
}

/** Decrypt any stored message body: sealed box first, then legacy. */
export async function decryptAnyMessage(
    ownerId: string,
    rawContent: string,
    peerId: string
): Promise<string> {
    const parsed = parseMessagePayload(rawContent);
    if (!parsed) return rawContent;
    if (isSealedBox(parsed)) {
        return decryptSealedBox(ownerId, parsed);
    }
    const legacyKey = await deriveSharedKey(ownerId, peerId);
    return decryptMessage(parsed, legacyKey);
}

// --- PROVABLY FAIR UTILITIES ---

export function generateRandomNonce(): string {
    const array = new Uint8Array(16);
    window.crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256(message: string): Promise<string> {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
