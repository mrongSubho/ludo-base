import test from 'node:test';
import assert from 'node:assert/strict';
import {
    wrapEip1193Provider,
    installWagmiConnectorGuards,
    guardAsyncSignature,
    guardAsyncTransaction,
    type Eip1193Provider,
} from '../lib/walletGuard';
import {
    isAuthPromptOpen,
    getAuthPromptState,
    showAuthPrompt,
    hideAuthPrompt,
} from '../hooks/useAuthPrompt';

test('walletGuard: personal_sign triggers signature modal and cleans up', async () => {
    hideAuthPrompt();
    assert.equal(isAuthPromptOpen(), false);

    let providerCalled = false;
    const mockProvider: Eip1193Provider = {
        request: async ({ method }) => {
            providerCalled = true;
            assert.equal(method, 'personal_sign');
            assert.equal(isAuthPromptOpen(), true);
            assert.equal(getAuthPromptState().mode, 'signature');
            return '0xsignature';
        },
    };

    wrapEip1193Provider(mockProvider);
    const result = await mockProvider.request({ method: 'personal_sign', params: ['0x123'] });

    assert.equal(providerCalled, true);
    assert.equal(result, '0xsignature');
    assert.equal(isAuthPromptOpen(), false);
});

test('walletGuard: eth_sendTransaction triggers transaction modal and updates status', async () => {
    hideAuthPrompt();
    assert.equal(isAuthPromptOpen(), false);

    let providerCalled = false;
    const mockProvider: Eip1193Provider = {
        request: async ({ method }) => {
            providerCalled = true;
            assert.equal(method, 'eth_sendTransaction');
            assert.equal(isAuthPromptOpen(), true);
            assert.equal(getAuthPromptState().mode, 'transaction');
            return '0xtxhash';
        },
    };

    wrapEip1193Provider(mockProvider);
    const result = await mockProvider.request({ method: 'eth_sendTransaction', params: [{}] });

    assert.equal(providerCalled, true);
    assert.equal(result, '0xtxhash');
    assert.equal(isAuthPromptOpen(), false);
});

test('walletGuard: respects existing explicit modal context without overwrite', async () => {
    hideAuthPrompt();
    const hideExplicit = showAuthPrompt({
        context: 'mission-claim',
        title: 'CUSTOM MISSION MODAL',
    });

    assert.equal(isAuthPromptOpen(), true);
    assert.equal(getAuthPromptState().title, 'CUSTOM MISSION MODAL');

    const mockProvider: Eip1193Provider = {
        request: async () => {
            assert.equal(getAuthPromptState().title, 'CUSTOM MISSION MODAL');
            return '0xsig';
        },
    };

    wrapEip1193Provider(mockProvider);
    await mockProvider.request({ method: 'personal_sign', params: [] });

    // Ensure the custom explicit prompt was NOT closed or overwritten by the fallback
    assert.equal(isAuthPromptOpen(), true);
    assert.equal(getAuthPromptState().title, 'CUSTOM MISSION MODAL');

    hideExplicit();
    assert.equal(isAuthPromptOpen(), false);
});

test('walletGuard: installWagmiConnectorGuards intercepts connector provider', async () => {
    hideAuthPrompt();

    const fakeConnector = {
        id: 'metaMask',
        name: 'MetaMask',
        getProvider: async () => ({
            request: async ({ method }: { method: string }) => {
                assert.equal(isAuthPromptOpen(), true);
                return `done:${method}`;
            },
        }),
    };

    const mockConfig = {
        connectors: [fakeConnector],
    };

    installWagmiConnectorGuards(mockConfig);
    const provider = (await fakeConnector.getProvider()) as Eip1193Provider;

    assert.equal(isAuthPromptOpen(), false);
    const res = await provider.request({ method: 'personal_sign' });
    assert.equal(res, 'done:personal_sign');
    assert.equal(isAuthPromptOpen(), false);
});

test('walletGuard: guardAsyncSignature and guardAsyncTransaction wrap functions correctly', async () => {
    hideAuthPrompt();

    const sigResult = await guardAsyncSignature(async () => {
        assert.equal(isAuthPromptOpen(), true);
        assert.equal(getAuthPromptState().mode, 'signature');
        return 'sig123';
    });
    assert.equal(sigResult, 'sig123');
    assert.equal(isAuthPromptOpen(), false);

    const txResult = await guardAsyncTransaction(async () => {
        assert.equal(isAuthPromptOpen(), true);
        assert.equal(getAuthPromptState().mode, 'transaction');
        return 'tx123';
    });
    assert.equal(txResult, 'tx123');
    assert.equal(isAuthPromptOpen(), false);
});
