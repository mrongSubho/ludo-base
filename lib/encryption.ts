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
    /** 1 = ECDH sealed box using the retired SHA-256(tag || secret) KDF (decrypt-only).
     *  2 = current: real HKDF-SHA-256, salt + sender static key carried here. */
    v: 1 | 2;
    /** v2 only: 16 HKDF salt bytes, base64. */
    salt?: string;
    /** v2 only: the sender's static public JWK, base64 of its canonical JSON. */
    from?: string;
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
    // CRY-03 / CRY-01: both versions are valid shapes, but a v2 box must carry
    // its salt or the HKDF cannot be reproduced.
    if ((v.v !== 1 && v.v !== 2) || typeof v.iv !== 'string' || typeof v.content !== 'string') {
        return false;
    }
    // The ephemeral key must actually be a P-256 public JWK. Checking only that
    // `epk` is truthy let `epk: 42` through, which then failed much later inside
    // importKey — as a decrypt error on the client, or as a stored row that can
    // never be opened, rather than as a rejected request at the door.
    const epk = v.epk as JsonWebKey | undefined;
    if (typeof epk !== 'object' || epk === null) return false;
    if (epk.kty !== 'EC' || epk.crv !== 'P-256') return false;
    if (typeof epk.x !== 'string' || typeof epk.y !== 'string') return false;
    if (v.v === 2 && typeof v.salt !== 'string') return false;
    return true;
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

/**
 * CRY-01: the real HKDF.
 *
 * The previous derivation was `SHA-256("ludo-dm-ecdh-v1" || sharedSecret)` with a
 * comment calling it "HKDF-ish". It is not HKDF: there is no extract step, no
 * expand step, and — the part that matters — the derived key binds **nothing
 * about who is talking**. The same shared secret under a different transcript
 * produced the same AES key, so the key was not domain-separated per conversation.
 *
 * Now `crypto.subtle.deriveBits({ name: "HKDF", ... })`, with:
 *   salt — 16 random bytes, carried in the sealed box so the recipient can
 *          reproduce it. A fixed salt was never a salt.
 *   info — the domain tag concatenated with BOTH static public keys, so the key
 *          is bound to this exact sender/recipient pair and this protocol
 *          version. Reflecting the keys into `info` is what stops a key derived
 *          for one peer from being usable in another transcript.
 *
 * The v1 path is retained for DECRYPT ONLY. Historical rows were sealed with the
 * old derivation and must stay readable; nothing new is ever written with it.
 */
const HKDF_INFO_PREFIX = 'ludo-dm-ecdh-v2';

async function deriveAesKeyV2(
    priv: CryptoKey,
    pub: CryptoKey,
    salt: Uint8Array,
    senderStaticPub: JsonWebKey,
    recipientStaticPub: JsonWebKey,
): Promise<CryptoKey> {
    const bits = await crypto.subtle.deriveBits({ name: CURVE, public: pub }, priv, 256);
    const info = concatBytes(
        new TextEncoder().encode(HKDF_INFO_PREFIX),
        new TextEncoder().encode(canonicalJwk(senderStaticPub)),
        new TextEncoder().encode(canonicalJwk(recipientStaticPub)),
    );
    const okm = await crypto.subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt, info },
        await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveBits']),
        256,
    );
    return crypto.subtle.importKey('raw', okm, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** @deprecated CRY-01 v1: `SHA-256(tag || sharedSecret)`. Decrypt only. */
async function deriveAesKeyV1(priv: CryptoKey, pub: CryptoKey): Promise<CryptoKey> {
    const bits = await crypto.subtle.deriveBits({ name: CURVE, public: pub }, priv, 256);
    const salt = new TextEncoder().encode('ludo-dm-ecdh-v1');
    const combined = new Uint8Array(salt.length + bits.byteLength);
    combined.set(salt, 0);
    combined.set(new Uint8Array(bits), salt.length);
    const digest = await crypto.subtle.digest('SHA-256', combined);
    return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const p of parts) {
        out.set(p, at);
        at += p.length;
    }
    return out;
}

/** Stable JWK text for HKDF `info`, so key order cannot change the derivation. */
function canonicalJwk(jwk: JsonWebKey): string {
    return JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
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
    const senderStatic = await getOrCreateIdentityKey(senderId);
    // CRY-01: 16 random salt bytes, carried in the box. The old derivation used a
    // constant "salt", which is just a domain tag.
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const aesKey = await deriveAesKeyV2(
        ephemeral.privateKey,
        peerPub,
        salt,
        await crypto.subtle.exportKey('jwk', senderStatic.publicKey),
        recipientPublicKeyJwk,
    );

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new TextEncoder().encode(text);
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, data);
    const epk = await crypto.subtle.exportKey('jwk', ephemeral.publicKey);

    return {
        v: 2,
        epk,
        iv: b64encode(iv),
        salt: b64encode(salt),
        // CRY-02 (partial): the sender's static public key now travels with the
        // box, so a recipient can tell who a message claims to be from and bind
        // it into the KDF. Authentication of that claim still needs a signature
        // and is deliberately not faked here.
        from: b64encode(new TextEncoder().encode(canonicalJwk(
            await crypto.subtle.exportKey('jwk', senderStatic.publicKey),
        ))),
        content: b64encode(encrypted),
    };
}

/** Decrypt a sealed box using this identity's static private key. */
export async function decryptSealedBox(ownerId: string, box: SealedBox): Promise<string> {
    const pair = await getOrCreateIdentityKey(ownerId);
    const epk = await importPeerPublicKey(box.epk);

    // CRY-01: v1 boxes were sealed with the old SHA-256(tag || secret) derivation
    // and must stay readable, so the version selects the path. Nothing new is
    // written as v1.
    let aesKey: CryptoKey;
    if (box.v === 2 && box.salt) {
        const senderStatic = box.from
            ? (JSON.parse(new TextDecoder().decode(b64decode(box.from))) as JsonWebKey)
            : await crypto.subtle.exportKey('jwk', pair.publicKey);
        // The recipient's own static key plays the "recipient" role.
        aesKey = await deriveAesKeyV2(
            pair.privateKey,
            epk,
            b64decode(box.salt),
            senderStatic,
            await crypto.subtle.exportKey('jwk', pair.publicKey),
        );
    } else {
        aesKey = await deriveAesKeyV1(pair.privateKey, epk);
    }

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

/** Encrypt using the legacy wallet-derived key; retained only for old rows. */
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

/** Decrypt a legacy `{iv, content}` payload using its already-derived key. */
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

/** Generate a cryptographically random 128-bit nonce as lowercase hex. */
export function generateRandomNonce(): string {
    const array = new Uint8Array(16);
    window.crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Hash a string with SHA-256 and return its lowercase hexadecimal digest. */
export async function sha256(message: string): Promise<string> {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
