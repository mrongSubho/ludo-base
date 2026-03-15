/**
 * Simple E2EE utility using Web Crypto API (AES-GCM)
 */

export async function generateKey(): Promise<CryptoKey> {
    return await window.crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
    );
}

export async function exportKey(key: CryptoKey): Promise<string> {
    const exported = await window.crypto.subtle.exportKey('raw', key);
    return btoa(String.fromCharCode(...new Uint8Array(exported)));
}

export async function importKey(keyData: string): Promise<CryptoKey> {
    const binary = atob(keyData);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return await window.crypto.subtle.importKey(
        'raw',
        bytes,
        'AES-GCM',
        true,
        ['encrypt', 'decrypt']
    );
}

export async function encryptMessage(text: string, key: CryptoKey): Promise<{ iv: string; content: string }> {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    
    const encrypted = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        data
    );

    return {
        iv: btoa(String.fromCharCode(...new Uint8Array(iv))),
        content: btoa(String.fromCharCode(...new Uint8Array(encrypted)))
    };
}

export async function decryptMessage(encryptedData: { iv: string; content: string }, key: CryptoKey): Promise<string> {
    const iv = new Uint8Array(atob(encryptedData.iv).split('').map(c => c.charCodeAt(0)));
    const content = new Uint8Array(atob(encryptedData.content).split('').map(c => c.charCodeAt(0)));

    const decrypted = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        content
    );

    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
}

// For simplicity in this Ludo app, we use a deterministic shared secret derived from wallet addresses + a secret string
// In a production app, we would use proper Diffie-Hellman key exchange.
export async function deriveSharedKey(walletA: string, walletB: string, salt = 'ludo-secret-salt-2024'): Promise<CryptoKey> {
    const ids = [walletA.toLowerCase(), walletB.toLowerCase()].sort();
    const combined = ids.join(':') + salt;
    
    const encoder = new TextEncoder();
    const data = encoder.encode(combined);
    
    const hash = await window.crypto.subtle.digest('SHA-256', data);
    
    return await window.crypto.subtle.importKey(
        'raw',
        hash,
        'AES-GCM',
        true,
        ['encrypt', 'decrypt']
    );
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
