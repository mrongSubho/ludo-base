/**
 * Universal Dual-Modal Wallet Guard.
 *
 * Guarantees that NO wallet signature or on-chain transaction approval
 * anywhere in the app can pop up without the Dual Modal Mode active.
 */

import {
    isAuthPromptOpen,
    showAuthPrompt,
    showTxPrompt,
    updateAuthPromptStatus,
} from '@/hooks/useAuthPrompt';

export const SIGNATURE_METHODS = new Set([
    'personal_sign',
    'eth_sign',
    'eth_signTypedData',
    'eth_signTypedData_v1',
    'eth_signTypedData_v3',
    'eth_signTypedData_v4',
]);

export const TRANSACTION_METHODS = new Set([
    'eth_sendTransaction',
    'eth_sendRawTransaction',
    'wallet_sendCalls',
]);

export interface Eip1193Provider {
    request: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<unknown>;
    [key: string]: unknown;
}

export function wrapEip1193Provider<T extends Eip1193Provider>(provider: T | null | undefined): T | null | undefined {
    if (!provider || typeof provider.request !== 'function') return provider;
    if ((provider as unknown as { __isLudoGuarded?: boolean }).__isLudoGuarded) return provider;

    const originalRequest = provider.request.bind(provider);

    const guardedRequest = async (args: { method: string; params?: unknown[] | Record<string, unknown> }) => {
        const method = args?.method;
        const isSig = SIGNATURE_METHODS.has(method);
        const isTx = TRANSACTION_METHODS.has(method);

        if (isSig) {
            if (isAuthPromptOpen()) {
                return originalRequest(args);
            }
            const hide = showAuthPrompt({
                context: 'general',
                title: 'WALLET SIGN-IN REQUIRED',
                badgeText: 'Awaiting Signature',
                statusText: 'Please approve the sign-in request in your wallet to proceed.',
                explanationText: 'Zero gas fee. Sign-in only proves wallet ownership.',
            });
            try {
                return await originalRequest(args);
            } finally {
                hide();
            }
        }

        if (isTx) {
            if (isAuthPromptOpen()) {
                const res = await originalRequest(args);
                updateAuthPromptStatus('Transaction submitted! Confirming on-chain...', 'Confirming On-Chain');
                return res;
            }
            const hide = showTxPrompt({
                context: 'contract-call',
                title: 'ON-CHAIN TRANSACTION REQUIRED',
                badgeText: 'Awaiting Confirmation',
                statusText: 'Please approve the transaction in your wallet to proceed on-chain.',
                explanationText: 'Standard network gas fee applies on Base. Transaction will be verified on-chain.',
                networkText: 'Base Sepolia (84532)',
            });
            try {
                const res = await originalRequest(args);
                updateAuthPromptStatus('Transaction submitted! Confirming on-chain...', 'Confirming On-Chain');
                return res;
            } finally {
                hide();
            }
        }

        return originalRequest(args);
    };

    provider.request = guardedRequest as typeof provider.request;
    (provider as unknown as { __isLudoGuarded: boolean }).__isLudoGuarded = true;
    return provider;
}

export function installWagmiConnectorGuards(config: { connectors?: readonly unknown[] }) {
    if (!config?.connectors) return;
    for (const rawConnector of config.connectors) {
        const connector = rawConnector as {
            __isLudoGuarded?: boolean;
            getProvider?: (params?: unknown) => Promise<unknown>;
        };
        if (!connector || typeof connector.getProvider !== 'function') continue;
        if (connector.__isLudoGuarded) continue;
        connector.__isLudoGuarded = true;

        const originalGetProvider = connector.getProvider.bind(connector);
        connector.getProvider = async function (params?: unknown) {
            const provider = await originalGetProvider(params);
            return wrapEip1193Provider(provider as Eip1193Provider);
        };
    }
}

export function installBrowserWindowGuard() {
    if (typeof window === 'undefined') return;
    const win = window as unknown as { ethereum?: Eip1193Provider };
    if (win.ethereum) {
        wrapEip1193Provider(win.ethereum);
    }

    // Modern multi-wallet discovery (EIP-6963)
    window.addEventListener('eip6963:announceProvider', ((event: CustomEvent<{ provider: Eip1193Provider }>) => {
        if (event?.detail?.provider) {
            wrapEip1193Provider(event.detail.provider);
        }
    }) as EventListener);
}

export async function guardAsyncSignature<T>(
    fn: () => Promise<T>,
    opts?: { title?: string; statusText?: string; explanationText?: string }
): Promise<T> {
    if (isAuthPromptOpen()) {
        return fn();
    }
    const hide = showAuthPrompt({
        context: 'general',
        title: opts?.title || 'WALLET SIGN-IN REQUIRED',
        badgeText: 'Awaiting Signature',
        statusText: opts?.statusText || 'Please approve the sign-in request in your wallet to proceed.',
        explanationText: opts?.explanationText || 'Zero gas fee. Sign-in only proves wallet ownership.',
    });
    try {
        return await fn();
    } finally {
        hide();
    }
}

export async function guardAsyncTransaction<T>(
    fn: () => Promise<T>,
    opts?: { title?: string; statusText?: string; explanationText?: string; networkText?: string }
): Promise<T> {
    if (isAuthPromptOpen()) {
        return fn();
    }
    const hide = showTxPrompt({
        context: 'contract-call',
        title: opts?.title || 'ON-CHAIN TRANSACTION REQUIRED',
        badgeText: 'Awaiting Confirmation',
        statusText: opts?.statusText || 'Please approve the transaction in your wallet to proceed on-chain.',
        explanationText: opts?.explanationText || 'Standard network gas fee applies on Base. Transaction will be verified on-chain.',
        networkText: opts?.networkText || 'Base Sepolia (84532)',
    });
    try {
        const res = await fn();
        updateAuthPromptStatus('Transaction submitted! Confirming on-chain...', 'Confirming On-Chain');
        return res;
    } finally {
        hide();
    }
}
