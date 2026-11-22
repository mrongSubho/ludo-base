import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
    DEFAULT_TREASURY_WALLET,
    DEFAULT_USDC_SEPOLIA_ADDRESS,
    MARKET_CURRENCIES,
    formatCustomCurrencyAmount,
    formatMarketAmount,
    marketCurrencyAmountWei,
    marketCurrencyDecimals,
    marketCurrencyDisplayValue,
    treasuryWalletAddress,
    usdcAddress,
} from '../lib/marketplacePrices';

const ROOT = process.cwd();

test('marketplace prices convert CHIPS, USDC, and ETH to Base Sepolia atomic units', () => {
    assert.deepEqual([...MARKET_CURRENCIES], ['CHIPS', 'USDC', 'ETH']);
    assert.equal(marketCurrencyDecimals('CHIPS'), 18);
    assert.equal(marketCurrencyDecimals('USDC'), 6);
    assert.equal(marketCurrencyDecimals('ETH'), 18);

    // Reference parity: 100 CHIPS = 1 USDC (1e6) = 0.0004 ETH (4e14 wei)
    assert.equal(marketCurrencyAmountWei(100, 'CHIPS'), BigInt(100) * BigInt(10) ** BigInt(18));
    assert.equal(marketCurrencyAmountWei(100, 'USDC'), BigInt(1_000_000));
    assert.equal(marketCurrencyAmountWei(100, 'ETH'), BigInt(400_000_000_000_000));

    // Zero or invalid prices never produce positive wei
    assert.equal(marketCurrencyAmountWei(0, 'USDC'), BigInt(0));
    assert.equal(marketCurrencyAmountWei(-5, 'ETH'), BigInt(0));

    assert.equal(marketCurrencyDisplayValue(500, 'CHIPS'), 500);
    assert.equal(marketCurrencyDisplayValue(500, 'USDC'), 5);
    assert.equal(marketCurrencyDisplayValue(500, 'ETH'), 0.002);

    assert.match(formatMarketAmount(500, 'CHIPS'), /500\s+CHIPS/);
    assert.match(formatMarketAmount(500, 'USDC'), /5\.00\s+USDC/);
    assert.match(formatMarketAmount(500, 'ETH'), /0\.0020\s+ETH/);
    assert.equal(formatCustomCurrencyAmount(10, 'USDC'), '10.00 USDC');
    assert.equal(formatCustomCurrencyAmount(0.005, 'ETH'), '0.0050 ETH');
});

test('marketplace treasury and USDC helpers default to Base Sepolia addresses', () => {
    assert.equal(usdcAddress().toLowerCase(), DEFAULT_USDC_SEPOLIA_ADDRESS.toLowerCase());
    assert.equal(treasuryWalletAddress().toLowerCase(), DEFAULT_TREASURY_WALLET.toLowerCase());
});

test('wallet asset & token send hooks pin Base Sepolia instead of Base Mainnet USDC', () => {
    const assetsSrc = fs.readFileSync(path.join(ROOT, 'hooks/useWalletAssets.ts'), 'utf8');
    const sendTokenSrc = fs.readFileSync(path.join(ROOT, 'hooks/useSendToken.ts'), 'utf8');
    const MAINNET_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

    assert.equal(assetsSrc.includes(MAINNET_USDC), false);
    assert.equal(sendTokenSrc.includes(MAINNET_USDC), false);
    assert.match(assetsSrc, /usePublicClient\(\{\s*chainId:\s*DEFAULT_CHAIN_ID\s*\}\)/);
    assert.match(sendTokenSrc, /Base Sepolia/);
});

test('MarketplacePanel fixes inspect scroll-lock, pins Base Sepolia, and removes coins UI copy', () => {
    const panelSrc = fs.readFileSync(path.join(ROOT, 'app/components/MarketplacePanel.tsx'), 'utf8');

    // Scroll lock fix: bodyScroll={false} lets inner overflow-y-auto panes scroll cleanly
    assert.match(panelSrc, /<GamePanelShell[\s\S]*bodyScroll=\{false\}/);

    // Base Sepolia branding + live wallet asset hook + Wallet Guard & chain switch
    assert.match(panelSrc, /BASE SEPOLIA/);
    assert.equal(panelSrc.includes('BASE NETWORK'), false);
    assert.match(panelSrc, /useWalletAssets\(\)/);
    assert.match(panelSrc, /showTxPrompt\(/);
    assert.match(panelSrc, /switchChainAsync\(\{\s*chainId:\s*DEFAULT_CHAIN_ID\s*\}\)/);
    assert.match(panelSrc, /cdpUserOp\.sendCallsAndWait/);

    // No "coins" or "COINS" UI strings remain (strip JS comments first)
    const noComments = panelSrc
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
    assert.equal(/\bcoins\b/i.test(noComments), false);
});

test('/api/marketplace/purchase supports verified Base Sepolia CHIPS, USDC, ETH and escrow fallback', () => {
    const routeSrc = fs.readFileSync(path.join(ROOT, 'app/api/marketplace/purchase/route.ts'), 'utf8');

    assert.match(routeSrc, /waitForConfirmedReceipt/);
    assert.match(routeSrc, /verifyErc20TransferLog/);
    assert.match(routeSrc, /getTransaction/);
    assert.match(routeSrc, /UserOperationEvent/);
    assert.match(routeSrc, /chips_events/);
    assert.match(routeSrc, /chips_escrow_spend_purchase/);
});
