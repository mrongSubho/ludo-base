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
