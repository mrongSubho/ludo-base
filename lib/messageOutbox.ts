/**
 * Local outbox persistence for pending & failed direct messages.
 *
 * Ensures that if a message fails (e.g. recipient hasn't published ECDH keys,
 * or temporary network error), the message is NOT lost on page refresh or panel close.
 * It remains visible in the chat thread with a retry button and keeps the conversation
 * listed in the conversations sidebar.
 */

export interface OutboxMessage {
    id: string;
    sender_id: string;
    receiver_id: string;
    content: string;
    is_read: boolean;
    created_at: string;
    deleted_by_sender: boolean | null;
    deleted_by_receiver: boolean | null;
    send_status?: 'sending' | 'failed' | 'sent';
    send_error?: string;
}

const OUTBOX_KEY_PREFIX = 'ludo-outbox-messages-';

function getOutboxKey(walletAddress: string): string {
    return `${OUTBOX_KEY_PREFIX}${walletAddress.toLowerCase()}`;
}

export function loadOutbox(walletAddress: string): OutboxMessage[] {
    if (typeof window === 'undefined' || !walletAddress) return [];
    try {
        const raw = localStorage.getItem(getOutboxKey(walletAddress));
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as OutboxMessage[]) : [];
    } catch {
        return [];
    }
}

export function saveOutboxMessage(walletAddress: string, msg: OutboxMessage): void {
    if (typeof window === 'undefined' || !walletAddress) return;
    try {
        const current = loadOutbox(walletAddress);
        const filtered = current.filter((m) => m.id !== msg.id);
        filtered.push(msg);
        localStorage.setItem(getOutboxKey(walletAddress), JSON.stringify(filtered));
    } catch {
        /* best-effort */
    }
}

export function removeOutboxMessage(walletAddress: string, msgId: string): void {
    if (typeof window === 'undefined' || !walletAddress) return;
    try {
        const current = loadOutbox(walletAddress);
        const filtered = current.filter((m) => m.id !== msgId);
        if (filtered.length === 0) {
            localStorage.removeItem(getOutboxKey(walletAddress));
        } else {
            localStorage.setItem(getOutboxKey(walletAddress), JSON.stringify(filtered));
        }
    } catch {
        /* best-effort */
    }
}

export function clearOutboxForPeer(walletAddress: string, peerId: string): void {
    if (typeof window === 'undefined' || !walletAddress || !peerId) return;
    try {
        const peerLower = peerId.toLowerCase();
        const current = loadOutbox(walletAddress);
        const filtered = current.filter((m) =>
            m.receiver_id?.toLowerCase() !== peerLower && m.sender_id?.toLowerCase() !== peerLower
        );
        if (filtered.length === 0) {
            localStorage.removeItem(getOutboxKey(walletAddress));
        } else {
            localStorage.setItem(getOutboxKey(walletAddress), JSON.stringify(filtered));
        }
    } catch {
        /* best-effort */
    }
}

// ─── Local cache for own-sent message plaintext ─────────────────────────────
// Sealed boxes (ECDH v2) can only be decrypted by the recipient holding their
// private key; the sender cannot decrypt their own box from the wire.
// Persisting recent sent plaintexts locally allows the sender to re-read their
// own sent messages across reloads/reboots within the session.

const SENT_CACHE_PREFIX = 'ludo-sent-plaintext-';

export function saveSentPlaintext(walletAddress: string, messageId: string, plaintext: string, ciphertext?: string): void {
    if (typeof window === 'undefined' || !walletAddress || !messageId) return;
    try {
        const key = `${SENT_CACHE_PREFIX}${walletAddress.toLowerCase()}`;
        const raw = localStorage.getItem(key);
        const map: Record<string, string> = raw ? JSON.parse(raw) : {};
        map[messageId] = plaintext;
        if (ciphertext) {
            map[ciphertext] = plaintext;
        }
        const keys = Object.keys(map);
        if (keys.length > 400) {
            for (let i = 0; i < keys.length - 400; i++) {
                delete map[keys[i]];
            }
        }
        localStorage.setItem(key, JSON.stringify(map));
    } catch {
        /* best-effort */
    }
}

export function getSentPlaintext(walletAddress: string, keyOrId: string): string | null {
    if (typeof window === 'undefined' || !walletAddress || !keyOrId) return null;
    try {
        const key = `${SENT_CACHE_PREFIX}${walletAddress.toLowerCase()}`;
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const map: Record<string, string> = JSON.parse(raw);
        return typeof map[keyOrId] === 'string' ? map[keyOrId] : null;
    } catch {
        return null;
    }
}
