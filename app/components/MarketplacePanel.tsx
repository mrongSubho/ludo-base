'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { encodeFunctionData, formatUnits, type Address } from 'viem';
import { useAccount, useSendTransaction, useSwitchChain, useWriteContract } from 'wagmi';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { usePreferences } from '@/hooks/usePreferences';
import { getOwned, addOwned } from '@/lib/inventory';
import { useAppSession } from '@/hooks/useAppSession';
import { usePlayerSigner } from '@/hooks/usePlayerSigner';
import { useCdpUserOp } from '@/hooks/useCdpUserOp';
import { showTxPrompt, updateAuthPromptStatus } from '@/hooks/useAuthPrompt';
import { useWalletAssets } from '@/hooks/useWalletAssets';
import { CHIPS_ERC20_ABI, chipsAddress } from '@/lib/chips';
import { DEFAULT_CHAIN_ID } from '@/lib/chains';
import {
    DEFAULT_CHIPS_ADDRESS,
    MARKET_CURRENCIES,
    formatCustomCurrencyAmount,
    formatMarketAmount,
    marketplaceTotalChips,
    marketCurrencyAmountWei,
    marketCurrencyDecimals,
    marketCurrencyDisplayValue,
    treasuryWalletAddress,
    usdcAddress,
    type MarketCurrency,
} from '@/lib/marketplacePrices';
import { getShowcased, setShowcased } from '@/lib/showcase';
import { useGuestWall } from '@/hooks/GuestWallContext';
import { GamePanelShell } from './GamePanelShell';
import { PanelTabs, TabCount } from './PanelTabs';
import { Button } from './Button';
import { Chip } from './Chip';
import { HudCornerTicks, HudProgressGauge, HudSectionLabel } from './HudPrimitives';
import { getSoundEngine } from '@/lib/audio/SoundEngine';
import { ThinkingOrb } from './ThinkingOrb';
import { ArmoryCrateIcon, CheckGlyphIcon, ChipsHexIcon } from './icons';

type MarketTab = 'themes' | 'dices' | 'tokens' | 'items';
type Rarity = 'common' | 'rare' | 'legendary';
type Mode = 'market' | 'loadout';
type SortKey = 'featured' | 'price-asc' | 'price-desc' | 'rarity';
type StatusFilter = 'all' | 'sale' | 'owned';

interface MarketActivity {
    event: 'Created' | 'Sale' | 'Transfer' | 'List';
    from: string;
    to: string;
    price?: number;
    currency?: MarketCurrency;
    duration?: string;
    date: string;
}

interface MarketTrait {
    trait_type: string;
    value: string;
    rarity_percent: number;
}

interface MarketItem {
    id: string;
    type: MarketTab;
    /** 'theme' | 'dice' | 'tokens' equip to real systems; 'item' is collectible-only */
    kind: 'theme' | 'dice' | 'tokens' | 'item';
    /** preference value applied on Equip (themes/dices/tokens only) */
    equipValue?: string;
    name: string;
    description: string;
    lore: string;
    price: number;
    owned: boolean;
    rarity: Rarity;
    collection: string;
    collectionStats: {
        floor: number;
        volume: number;
        owners: number;
    };
    creator: string;
    stats: { label: string; value: string; icon?: React.ReactNode }[];
    traits: MarketTrait[];
    activity: MarketActivity[];
    chainInfo: {
        address: string;
        standard: string;
        network: string;
    };
    previewColor: string;
    previewIcon?: React.ReactNode;
}

// ─── Token Icon & Multi-Currency Formatters ─────────────────────────────────
function formatBalanceShort(rawWei: bigint, currency: MarketCurrency): string {
    const decimals = marketCurrencyDecimals(currency);
    const num = Number(formatUnits(rawWei, decimals));
    if (!Number.isFinite(num) || num <= 0) return '0';
    if (currency === 'CHIPS') return Math.floor(num).toLocaleString();
    if (currency === 'USDC') return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return num.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 5 });
}

function formatCurrencyCompact(wholeChips: number, currency: MarketCurrency): string {
    if (currency === 'CHIPS') return `${formatCompact(wholeChips)} CHIPS`;
    return formatMarketAmount(wholeChips, currency);
}

function sanitizeDecimalInput(raw: string): string {
    const cleaned = raw.replace(/[^0-9.]/g, '');
    const parts = cleaned.split('.');
    if (parts.length <= 1) return cleaned;
    return `${parts[0]}.${parts.slice(1).join('').slice(0, 6)}`;
}

const TokenIcon = () => (
    <ChipsHexIcon className="w-3.5 h-3.5 text-accent" active />
);

// ─── Real item previews ─────────────────────────────────────────────────────
const PIPS_5 = [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]];

const DicePreview = ({ face, pip, box = 40 }: { face: string; pip: string; box?: number }) => (
    <div className="rounded-lg flex items-center justify-center shadow-lg" style={{ background: face, width: box, height: box }}>
        <svg viewBox="0 0 100 100" style={{ width: box * 0.72, height: box * 0.72 }}>
            {PIPS_5.map(([cx, cy], i) => (
                <circle key={i} cx={cx} cy={cy} r="11" fill={pip} />
            ))}
        </svg>
    </div>
);

const OrbPreview = ({ size = 44 }: { size?: number }) => (
    <div
        className="rounded-full"
        style={{
            width: size, height: size,
            background: 'radial-gradient(circle at 38% 35%, #60a5fa 0%, #3b82f6 30%, #2563eb 65%, #1d4ed8 100%)',
            border: '1.5px solid rgba(255,255,255,0.6)',
            boxShadow: '0 6px 16px rgba(0,0,0,0.45), inset 0 -3px 6px rgba(0,0,0,0.35), inset 0 3px 6px rgba(255,255,255,0.25)',
        }}
    />
);

/** Faceted relic gem for collectible items (they carry no previewIcon) */
const ItemRelic = ({ px, tint }: { px: number; tint: string }) => (
    <div className="relative flex items-center justify-center" style={{ width: px, height: px }}>
        <div
            className={`absolute inset-[8%] rotate-45 rounded-[22%] ${tint}`}
            style={{ border: '1px solid rgba(255,255,255,0.4)' }}
        />
        <div
            className="absolute inset-[8%] rotate-45 rounded-[22%]"
            style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.48), transparent 52%, rgba(0,0,0,0.48))' }}
        />
        <div
            className="absolute left-[1%] top-1/2 w-[98%] h-px -rotate-45"
            style={{ background: 'rgba(255,255,255,0.25)' }}
        />
        <div
            className="absolute left-[30%] top-[20%] w-[13%] h-[13%] rounded-full blur-[1px]"
            style={{ background: 'rgba(255,255,255,0.9)' }}
        />
    </div>
);

/** Micro-board swatch: 5x5 Ludo motif (path ring + home courts) — reads as a theme, not an icon */
const TEAM_DOTS = ['#fb7185', '#34d399', '#fbbf24', '#38bdf8'];
const TEAM_DOTS_3077 = ['#ff0055', '#00ff66', '#ffd000', '#0099ff'];
const ThemeSwatch = ({ mode = 'retro', light: propLight, size = 52 }: { mode?: '3077' | 'retro' | 'light'; light?: boolean; size?: number }) => {
    const is3077 = mode === '3077';
    const light = propLight !== undefined ? propLight : mode === 'light';
    const dots = is3077 ? TEAM_DOTS_3077 : TEAM_DOTS;
    const base = light ? '#dcd9ea' : is3077 ? '#0b0e14' : '#0b1221';
    const neutral = light ? '#c3c0d4' : is3077 ? 'rgba(0, 229, 255, 0.25)' : 'rgba(92, 225, 255, 0.28)';
    const corners = new Set([0, 4, 20, 24]);
    const ringOrder = [0, 1, 2, 3, 4, 9, 14, 19, 24, 23, 22, 21, 20, 15, 10, 5];
    const home: Record<number, string> = { 7: dots[0], 11: dots[1], 13: dots[2], 17: dots[3], 12: is3077 ? '#00e5ff' : light ? '#ffffff' : '#5ce1ff' };
    const cells: string[] = [];
    for (let i = 0; i < 25; i++) {
        if (home[i]) cells.push(home[i]);
        else if (corners.has(i)) cells.push(neutral);
        else if (ringOrder.includes(i)) cells.push(dots[ringOrder.indexOf(i) % 4]);
        else cells.push(base);
    }
    return (
        <div
            className={`relative rounded-xl overflow-hidden shadow-lg border ${is3077 ? 'border-accent/50 shadow-[0_0_15px_color-mix(in_srgb,var(--accent)_25%,transparent)]' : !light ? 'border-accent/40 shadow-[0_0_14px_color-mix(in_srgb,var(--accent)_22%,transparent)]' : 'border-line-soft'}`}
            style={{ width: size, height: size, background: light ? '#e8e6f0' : is3077 ? '#07080b' : '#060b14' }}
        >
            <div className="grid grid-cols-5 w-full h-full" style={{ gap: 1.5, padding: 5 }}>
                {cells.map((c, i) => (
                    <div key={i} className="rounded-xs" style={{ background: c }} />
                ))}
            </div>
            <div
                className="absolute inset-0 pointer-events-none"
                style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.28), transparent 50%, rgba(0,0,0,0.28))' }}
            />
        </div>
    );
};

// ─── Category meta (icons + labels) ─────────────────────────────────────────
const TAB_META: { id: MarketTab; label: string; icon: React.ReactNode }[] = [
    {
        id: 'themes', label: 'Themes',
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>,
    },
    {
        id: 'dices', label: 'Dices',
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><rect x="3" y="3" width="18" height="18" rx="4" /><circle cx="8.5" cy="8.5" r="1.4" fill="currentColor" stroke="none" /><circle cx="15.5" cy="15.5" r="1.4" fill="currentColor" stroke="none" /><circle cx="15.5" cy="8.5" r="1.4" fill="currentColor" stroke="none" /><circle cx="8.5" cy="15.5" r="1.4" fill="currentColor" stroke="none" /></svg>,
    },
    {
        id: 'tokens', label: 'Tokens',
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></svg>,
    },
    {
        id: 'items', label: 'Items',
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" className="w-4 h-4"><path d="M12 2l8 4.5v9L12 20l-8-4.5v-9L12 2z" /><path d="M12 11L4 6.5M12 11l8-4.5M12 11v9" /></svg>,
    },
];

const RARITY_RANK: Record<Rarity, number> = { common: 1, rare: 2, legendary: 3 };
const RARITY_BEAM: Record<Rarity, string> = {
    common: 'bg-line-strong',
    rare: 'bg-accent shadow-[0_0_12px_rgba(0,229,255,0.7)]',
    legendary: 'bg-warn shadow-[0_0_12px_rgba(245,158,11,0.75)]',
};

const SORT_LABELS: Record<SortKey, string> = {
    featured: 'Featured',
    'price-asc': 'Price ↑',
    'price-desc': 'Price ↓',
    rarity: 'Top rarity',
};

/** Compact coin formatting: 1100 → "1.1K" (keeps footer buttons from overflowing) */
const formatCompact = (n: number) => {
    if (n >= 1000) {
        const v = n / 1000;
        return `${Number.isInteger(v) ? v : v.toFixed(1)}K`;
    }
    return n.toLocaleString();
};

const RARITY_HALO: Record<Rarity, string> = {
    common: 'rgba(148,163,184,0.16)',
    rare: 'rgba(0,229,255,0.28)',
    legendary: 'rgba(245,158,11,0.34)',
};

/** Singular display names per category (set-bar copy, loadout labels) */
const TAB_SINGULAR: Record<MarketTab, string> = {
    themes: 'Theme',
    dices: 'Dice',
    tokens: 'Token',
    items: 'Relic',
};

interface MarketplacePanelProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function MarketplacePanel({ isOpen, onClose }: MarketplacePanelProps) {
    // ─── Catalog (real gear: themes/dices/tokens equip, items are collectibles) ───
    const [marketData, setMarketData] = useState<MarketItem[]>([
        // ─── Themes (equip = instant theme activation) ───
        {
            id: 'theme-3077', type: 'themes', kind: 'theme', equipValue: '3077',
            name: 'Cyber-Tactical 3077',
            description: 'Flagship matte carbon chassis with hyper-cyan HUD telemetry.',
            lore: 'Calibrated in Year 3077 for high-stakes onchain combatants who demand razor-sharp mechanical focus.',
            price: 0, owned: true, rarity: 'legendary', collection: '3077 Protocol', creator: 'CyberSyndicate',
            collectionStats: { floor: 0, volume: 250000, owners: 75000 },
            stats: [{ label: 'Mode', value: 'HUD' }, { label: 'Applies', value: 'Instant' }],
            traits: [{ trait_type: 'Style', value: 'Cyber-Tactical', rarity_percent: 100 }],
            activity: [{ event: 'Created', from: 'Protocol 3077', to: 'Arena', date: 'Genesis' }],
            chainInfo: { address: '0x307...777', standard: 'SBT', network: 'Base Sepolia' },
            previewColor: 'bg-[#07080b]',
        },
        {
            id: 'theme-retro', type: 'themes', kind: 'theme', equipValue: 'retro',
            name: 'Retro Night',
            description: 'Deep space terminal aesthetic for focused gaming.',
            lore: 'Forged in the heart of a dying star, Retro Night brings the calm of the void to your board.',
            price: 0, owned: true, rarity: 'common', collection: 'Foundations', creator: 'LudoCorp',
            collectionStats: { floor: 0, volume: 100000, owners: 50000 },
            stats: [{ label: 'Mode', value: 'Dark' }, { label: 'Applies', value: 'Instant' }],
            traits: [{ trait_type: 'Style', value: 'Terminal', rarity_percent: 100 }],
            activity: [{ event: 'Created', from: 'System', to: 'Player', date: 'Genesis' }],
            chainInfo: { address: '0x000...000', standard: 'SBT', network: 'Base Sepolia' },
            previewColor: 'bg-[#0a0b14]',
        },
        {
            id: 'theme-daybreak', type: 'themes', kind: 'theme', equipValue: 'light',
            name: 'Daybreak Porcelain',
            description: 'Soft-UI daylight porcelain for daytime grinders.',
            lore: 'When the void gets too dark, Daybreak opens a sunlit window onto a porcelain arena.',
            price: 500, owned: false, rarity: 'rare', collection: 'Prism', creator: 'Lux',
            collectionStats: { floor: 420, volume: 8600, owners: 1930 },
            stats: [{ label: 'Mode', value: 'Light' }, { label: 'Applies', value: 'Instant' }],
            traits: [{ trait_type: 'Style', value: 'Daybreak', rarity_percent: 35 }],
            activity: [{ event: 'Created', from: 'System', to: 'Market', date: 'Genesis' }],
            chainInfo: { address: '0x111...222', standard: 'ERC-1155', network: 'Base Sepolia' },
            previewColor: 'bg-[#e8e6f0]',
        },
        // ─── Dices (equip = real dice skin in matches) ───
        {
            id: 'dice-classic', type: 'dices', kind: 'dice', equipValue: 'classic',
            name: 'Classic D6',
            description: 'The reliable choice for every player.',
            lore: 'Sometimes, the old ways are the best. Balanced, weighted, and ready for action.',
            price: 0, owned: true, rarity: 'common', collection: 'Foundations', creator: 'LudoCorp',
            collectionStats: { floor: 0, volume: 100000, owners: 50000 },
            stats: [{ label: 'Reliability', value: 'Tier 1' }, { label: 'Applies', value: 'Instant' }],
            traits: [{ trait_type: 'Finish', value: 'Ivory', rarity_percent: 100 }],
            activity: [{ event: 'Created', from: 'System', to: 'Player', date: 'Genesis' }],
            chainInfo: { address: '0x000...000', standard: 'SBT', network: 'Base Sepolia' },
            previewColor: 'bg-surface-recessed', previewIcon: <DicePreview face="#ffffff" pip="#0F172A" />,
        },
        {
            id: 'dice-midnight', type: 'dices', kind: 'dice', equipValue: 'midnight',
            name: 'Midnight D6',
            description: 'Cold neon pips on a void-black cube.',
            lore: 'Rolled in the dark between stars. The cyan pips glow faintly with every tumble.',
            price: 300, owned: false, rarity: 'rare', collection: 'Prism', creator: 'Lux',
            collectionStats: { floor: 260, volume: 5400, owners: 1210 },
            stats: [{ label: 'Glow', value: 'Neon' }, { label: 'Applies', value: 'Instant' }],
            traits: [{ trait_type: 'Finish', value: 'Void', rarity_percent: 25 }],
            activity: [{ event: 'Created', from: 'System', to: 'Market', date: 'Genesis' }],
            chainInfo: { address: '0x333...444', standard: 'ERC-1155', network: 'Base Sepolia' },
            previewColor: 'bg-[#0b1220]', previewIcon: <DicePreview face="#0b1220" pip="#22d3ee" />,
        },
        {
            id: 'dice-gold', type: 'dices', kind: 'dice', equipValue: 'gold',
            name: 'Royal Gold D6',
            description: 'A dice fit for the High King of Ludo-Land.',
            lore: 'Every face plated in digital gold. Victory tastes sweeter when rolled in style.',
            price: 800, owned: false, rarity: 'legendary', collection: 'Royal Treasury', creator: 'MidasTouch',
            collectionStats: { floor: 740, volume: 1900, owners: 320 },
            stats: [{ label: 'Prestige', value: '99' }, { label: 'Applies', value: 'Instant' }],
            traits: [{ trait_type: 'Material', value: '24k Gold', rarity_percent: 3 }],
            activity: [{ event: 'Created', from: 'System', to: 'Market', date: 'Genesis' }],
            chainInfo: { address: '0x555...666', standard: 'ERC-721', network: 'Base Sepolia' },
            previewColor: 'bg-[#451a03]', previewIcon: <DicePreview face="#451a03" pip="#fcd34a" />,
        },
        // ─── Tokens (equip = real pawn style in matches) ───
        {
            id: 'tokens-pawn', type: 'tokens', kind: 'tokens', equipValue: 'pawn',
            name: 'Chess Pieces',
            description: 'Classic ranked chess-piece tokens.',
            lore: 'From pawn to king — your rank rides with every piece on the board.',
            price: 0, owned: true, rarity: 'common', collection: 'Foundations', creator: 'LudoCorp',
            collectionStats: { floor: 0, volume: 100000, owners: 50000 },
            stats: [{ label: 'Style', value: 'Ranked' }, { label: 'Applies', value: 'Instant' }],
            traits: [{ trait_type: 'Set', value: 'Full Chess', rarity_percent: 100 }],
            activity: [{ event: 'Created', from: 'System', to: 'Player', date: 'Genesis' }],
            chainInfo: { address: '0x000...000', standard: 'SBT', network: 'Base Sepolia' },
            previewColor: 'bg-surface-recessed',
            previewIcon: <img loading="lazy" decoding="async" src="/tokens/king.png" alt="Chess" width={44} height={44} style={{ width: 44, height: 44, objectFit: 'contain' }} />,
        },
        {
            id: 'tokens-orb', type: 'tokens', kind: 'tokens', equipValue: 'orb',
            name: 'Orb Discs',
            description: 'Glossy element orbs with team-colored glow.',
            lore: 'Polished spheres humming with arena energy. Clean, fast, unmistakable.',
            price: 300, owned: false, rarity: 'rare', collection: 'Elemental', creator: 'Vulcan',
            collectionStats: { floor: 260, volume: 4800, owners: 1140 },
            stats: [{ label: 'Finish', value: 'Gloss' }, { label: 'Applies', value: 'Instant' }],
            traits: [{ trait_type: 'Core', value: 'Arcane', rarity_percent: 25 }],
            activity: [{ event: 'Created', from: 'System', to: 'Market', date: 'Genesis' }],
            chainInfo: { address: '0x777...888', standard: 'ERC-1155', network: 'Base Sepolia' },
            previewColor: 'bg-surface-recessed', previewIcon: <OrbPreview size={44} />,
        },
        // ─── Items (collectibles: own + showcase, no equip) ───
        {
            id: 's1', type: 'items', kind: 'item', name: 'Crystal',
            description: 'Translucent tokens with prismatic reflections.',
            lore: 'Carved from the ice of the Northern Peaks, these Crystal tokens refract light into a dazzling spectrum of colors. Fragile in appearance, but unbreakable in spirit.',
            price: 180, owned: false, rarity: 'rare', collection: 'Elemental', creator: 'FrostByte',
            collectionStats: { floor: 150, volume: 12000, owners: 4500 },
            stats: [{ label: 'Clarity', value: '98%' }, { label: 'Durability', value: 'Hard' }],
            traits: [
                { trait_type: 'Element', value: 'Ice', rarity_percent: 25 },
                { trait_type: 'Transparency', value: '98%', rarity_percent: 15 },
            ],
            activity: [
                { event: 'Sale', from: '0x441...111', to: '0x222...333', price: 175, date: '6h ago' },
                { event: 'Created', from: 'System', to: '0x441...111', date: '1w ago' },
            ],
            chainInfo: { address: '0x123...456', standard: 'ERC-1155', network: 'Base Sepolia' },
            previewColor: 'bg-accent/25',
        },
        {
            id: 's2', type: 'items', kind: 'item', name: 'Magma',
            description: 'Tokens born from volcanic fire.',
            lore: 'Don\'t touch the edges. These tokens are literal chunks of cooled magma, still glowing with the inner heat of the earth. Perfect for players with a fiery competitive streak.',
            price: 300, owned: false, rarity: 'rare', collection: 'Elemental', creator: 'Vulcan',
            collectionStats: { floor: 260, volume: 12000, owners: 4500 },
            stats: [{ label: 'Heat', value: 'High' }, { label: 'Mass', value: 'Heavy' }],
            traits: [
                { trait_type: 'Element', value: 'Fire', rarity_percent: 25 },
                { trait_type: 'Temperature', value: 'Extreme', rarity_percent: 10 },
            ],
            activity: [
                { event: 'Transfer', from: '0x888...999', to: '0x222...333', date: '12h ago' },
                { event: 'Sale', from: '0x555...666', to: '0x888...999', price: 290, date: '1d ago' },
            ],
            chainInfo: { address: '0x987...654', standard: 'ERC-1155', network: 'Base Sepolia' },
            previewColor: 'bg-orange-600/80',
        },
        {
            id: 's3', type: 'items', kind: 'item', name: 'Void',
            description: 'Tokens that absorb all surrounding light.',
            lore: 'Nothingness. The Void tokens occupy space without reflecting a single photon. They are a reminder that in the end, the board always wins. Use with caution.',
            price: 2000, owned: false, rarity: 'legendary', collection: 'The Unknown', creator: 'Shadow',
            collectionStats: { floor: 1800, volume: 500, owners: 120 },
            stats: [{ label: 'Stealth', value: '100' }, { label: 'Gravity', value: 'Stable' }],
            traits: [
                { trait_type: 'Material', value: 'Dark Matter', rarity_percent: 1 },
                { trait_type: 'Reflection', value: '0%', rarity_percent: 1 },
            ],
            activity: [
                { event: 'Sale', from: '0xaaa...bbb', to: '0xccc...ddd', price: 1950, date: '3d ago' },
                { event: 'Created', from: 'System', to: '0xaaa...bbb', date: '1mo ago' },
            ],
            chainInfo: { address: '0xabc...def', standard: 'ERC-1155', network: 'Base Sepolia' },
            previewColor: 'bg-[#050608]',
        },
        { id: 's4', type: 'items', kind: 'item', name: 'Neon-X', description: 'Electric skin.', lore: 'Pulsing neon.', price: 100, owned: false, rarity: 'common', collection: 'Core', creator: 'G', collectionStats: { floor: 80, volume: 2000, owners: 4100 }, stats: [], traits: [], activity: [], chainInfo: { address: '0x1', standard: 'ERC', network: 'Base Sepolia' }, previewColor: 'bg-sky-600/70' },
        { id: 's5', type: 'items', kind: 'item', name: 'Cyber-V', description: 'Matrix skin.', lore: 'The digital frontier.', price: 240, owned: false, rarity: 'rare', collection: 'Core', creator: 'G', collectionStats: { floor: 200, volume: 1800, owners: 1900 }, stats: [], traits: [], activity: [], chainInfo: { address: '0x1', standard: 'ERC', network: 'Base Sepolia' }, previewColor: 'bg-accent/40' },
        { id: 's6', type: 'items', kind: 'item', name: 'Steel-Z', description: 'Metal skin.', lore: 'Cold steel.', price: 60, owned: false, rarity: 'common', collection: 'Core', creator: 'G', collectionStats: { floor: 45, volume: 900, owners: 5200 }, stats: [], traits: [], activity: [], chainInfo: { address: '0x1', standard: 'ERC', network: 'Base Sepolia' }, previewColor: 'bg-slate-600/70' },
    ]);

    // ─── Mode + navigation state ───
    const [mode, setMode] = useState<Mode>('market');
    const [activeTab, setActiveTab] = useState<MarketTab>('themes');
    const [currency, setCurrency] = useState<MarketCurrency>('CHIPS');
    const [selectedItem, setSelectedItem] = useState<MarketItem | null>(null);
    const [confirmItem, setConfirmItem] = useState<MarketItem | null>(null);
    const [isSelling, setIsSelling] = useState(false);
    const [sellPrice, setSellPrice] = useState('');
    const [sellCurrency, setSellCurrency] = useState<MarketCurrency>('CHIPS');
    const [listingDuration, setListingDuration] = useState<'7d' | '30d' | 'indefinite'>('7d');

    // ─── Toolbar state ───
    const [search, setSearch] = useState('');
    const [sort, setSort] = useState<SortKey>('featured');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
    const [rarityFilter, setRarityFilter] = useState<'all' | Rarity>('all');
    const [density, setDensity] = useState<'comfort' | 'compact'>('compact');
    const [filterOpen, setFilterOpen] = useState(false);

    // ─── Transaction + try-on state ───
    const [isProcessing, setIsProcessing] = useState(false);
    const [transactionResult, setTransactionResult] = useState<'success' | 'error' | null>(null);
    const [successNote, setSuccessNote] = useState('');
    const [errorNote, setErrorNote] = useState('');
    const [ownedIds, setOwnedIds] = useState<string[]>(() => getOwned(null));
    const [showcasedId, setShowcasedId] = useState<string | null>(null);

    // Keep the active category chip in view when switching tabs.
    // NOTE: never use scrollIntoView here — it bubbles into the panel root
    // (overflow:hidden IS a programmatic scroll container) and shifts the whole
    // panel content sideways. Scroll the rail element directly instead.
    const activeChipRef = useRef<HTMLButtonElement | null>(null);
    const railRef = useRef<HTMLDivElement | null>(null);
    const panelRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        // Defensive: the panel itself must never be scrolled.
        if (panelRef.current) {
            panelRef.current.scrollLeft = 0;
            panelRef.current.scrollTop = 0;
        }
        const rail = railRef.current;
        const chip = activeChipRef.current;
        if (rail && chip) {
            rail.scrollTo({
                left: chip.offsetLeft - rail.clientWidth / 2 + chip.clientWidth / 2,
                behavior: 'smooth',
            });
        }
    }, [activeTab]);

    // ─── Real inventory + Base Sepolia wallet balances ───
    const { address } = useCurrentUser();
    // Guests may browse + showcase, but buying hits the wall.
    const { guard } = useGuestWall();
    const { ensureAppSession } = useAppSession();
    const player = usePlayerSigner();
    const { chainId } = useAccount();
    const { switchChainAsync } = useSwitchChain();
    const { writeContractAsync } = useWriteContract();
    const { sendTransactionAsync } = useSendTransaction();
    const cdpUserOp = useCdpUserOp(DEFAULT_CHAIN_ID);
    const walletAssets = useWalletAssets();
    const { preferences, updatePreference } = usePreferences();
    const wallet = address?.toLowerCase() ?? null;

    const activeBalanceWei =
        (currency === 'CHIPS' ? walletAssets.chips : currency === 'USDC' ? walletAssets.usdc : walletAssets.eth) ?? BigInt(0);
    const hasEnoughFor = (wholeChips: number) =>
        activeBalanceWei >= marketCurrencyAmountWei(wholeChips, currency);
    const shortfallText = (wholeChips: number) => {
        const required = marketCurrencyAmountWei(wholeChips, currency);
        if (activeBalanceWei >= required) return `0 ${currency}`;
        const diff = required - activeBalanceWei;
        const decimals = marketCurrencyDecimals(currency);
        const val = Number(formatUnits(diff, decimals));
        return formatCustomCurrencyAmount(val, currency);
    };

    useEffect(() => {
        if (isOpen && wallet) {
            void walletAssets.refresh();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, wallet]);

    useEffect(() => {
        if (isOpen) {
            setOwnedIds(getOwned(wallet));
            setShowcasedId(getShowcased(wallet));
        }
    }, [isOpen, wallet]);

    const isOwnedId = (id: string) => ownedIds.includes(id);
    const equipKeyFor = (kind: MarketItem['kind']) =>
        kind === 'theme' ? 'ludo-theme' : kind === 'dice' ? 'dice-style' : 'token-style';
    const isEquipped = (item: MarketItem) => {
        if (!item.equipValue) return false;
        if (item.kind === 'theme') return preferences.theme === item.equipValue;
        if (item.kind === 'dice') return preferences.diceStyle === item.equipValue;
        if (item.kind === 'tokens') return preferences.tokenStyle === item.equipValue;
        return false;
    };
    const handleEquip = (item: MarketItem) => {
        if (!item.equipValue) return;
        updatePreference(equipKeyFor(item.kind) as 'ludo-theme', item.equipValue);
    };

    // ─── Activation ritual confirm: equip gear, or showcase a relic ───
    const confirmActivation = () => {
        if (!confirmItem) return;
        if (confirmItem.equipValue) handleEquip(confirmItem);
        else setShowcasedId(setShowcased(wallet, confirmItem.id));
        getSoundEngine().play('pref_cosmetic_swap');
        setConfirmItem(null);
    };

    // ─── Real purchase: Base Sepolia CHIPS / USDC / ETH on-chain transfer ───
    // Shared core so grid quick-buy and the inspect sheet use one flow.
    // External wallets enforce Base Sepolia chainId 84532; CDP smart accounts
    // execute via paymaster-sponsored sendCallsAndWait. Server verifies the
    // confirmed Base Sepolia receipt before unlocking inventory.
    const sendPurchase = async (ids: string[], payCurrency: MarketCurrency) => {
        const sessionId = await ensureAppSession({ context: 'marketplace' });
        if (!sessionId || !wallet) throw new Error('Sign-in required');
        const total = marketplaceTotalChips(ids);
        if (total === null) throw new Error('Unknown item');
        const amountWei = marketCurrencyAmountWei(total, payCurrency);
        if (amountWei <= BigInt(0)) throw new Error('Invalid purchase amount');

        const treasury = treasuryWalletAddress();
        const requestId = crypto.randomUUID();
        const priceLabel = formatMarketAmount(total, payCurrency);

        const hidePrompt = showTxPrompt({
            context: 'marketplace',
            title: 'COMPLETE PURCHASE',
            statusText: `Approve sending ${priceLabel} on Base Sepolia.`,
            explanationText: `Direct Base Sepolia (Chain ${DEFAULT_CHAIN_ID}) payment in ${payCurrency} to the marketplace treasury.`,
        });

        let txHash: `0x${string}`;
        try {
            if (player.mode === 'ingame' && cdpUserOp.isInGame) {
                if (payCurrency === 'ETH') {
                    txHash = await cdpUserOp.sendCallsAndWait(
                        [{ to: treasury, value: amountWei, data: '0x' }],
                        DEFAULT_CHAIN_ID,
                    );
                } else {
                    const tokenAddr: Address =
                        payCurrency === 'CHIPS'
                            ? ((chipsAddress() || DEFAULT_CHIPS_ADDRESS) as Address)
                            : usdcAddress();
                    const data = encodeFunctionData({
                        abi: CHIPS_ERC20_ABI,
                        functionName: 'transfer',
                        args: [treasury, amountWei],
                    });
                    txHash = await cdpUserOp.sendCallsAndWait([{ to: tokenAddr, data }], DEFAULT_CHAIN_ID);
                }
            } else {
                if (chainId && chainId !== DEFAULT_CHAIN_ID) {
                    await switchChainAsync({ chainId: DEFAULT_CHAIN_ID });
                }
                if (payCurrency === 'ETH') {
                    txHash = await sendTransactionAsync({
                        account: wallet as `0x${string}`,
                        to: treasury,
                        value: amountWei,
                        chainId: DEFAULT_CHAIN_ID,
                    });
                } else {
                    const tokenAddr: Address =
                        payCurrency === 'CHIPS'
                            ? ((chipsAddress() || DEFAULT_CHIPS_ADDRESS) as Address)
                            : usdcAddress();
                    txHash = await writeContractAsync({
                        address: tokenAddr,
                        abi: CHIPS_ERC20_ABI,
                        functionName: 'transfer',
                        args: [treasury, amountWei],
                        chainId: DEFAULT_CHAIN_ID,
                    });
                }
            }
            updateAuthPromptStatus('Payment broadcast! Verifying on Base Sepolia...', 'Confirming On-Chain');
        } finally {
            hidePrompt();
        }

        const response = await fetch('/api/marketplace/purchase', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                walletAddress: wallet,
                sessionId,
                itemIds: ids,
                requestId,
                currency: payCurrency,
                txHash,
            }),
        });
        const data = await response.json().catch(() => null);
        if (!response?.ok) throw new Error(data?.error || 'Purchase failed');

        await walletAssets.refresh();
        window.dispatchEvent(new CustomEvent('ludo-chips-refresh'));
        return data;
    };

    const buyItem = async (item: MarketItem) => {
        if (!wallet) return;
        if (!guard('market-buy')) return;
        if (!hasEnoughFor(item.price)) return;
        setIsProcessing(true);
        setTransactionResult(null);
        setErrorNote('');

        try {
            await sendPurchase([item.id], currency);

            const next = addOwned(wallet, item.id);
            setOwnedIds(next);

            window.dispatchEvent(new CustomEvent('ludo-profile-refresh'));

            const newActivity: MarketActivity = {
                event: 'Sale',
                from: 'Market',
                to: 'Player',
                price: marketCurrencyDisplayValue(item.price, currency),
                currency,
                date: 'Just now',
            };
            setMarketData(prev => prev.map(m =>
                m.id === item.id
                    ? { ...m, owned: true, activity: [newActivity, ...m.activity] }
                    : m,
            ));

            setIsProcessing(false);
            getSoundEngine().play('marketplace_purchase');
            setSuccessNote(`${item.name} added to your vault.`);
            setTransactionResult('success');
        } catch (err) {
            console.error('❌ [Market] Buy failed:', err);
            setIsProcessing(false);
            getSoundEngine().play('ui_error');
            setErrorNote(err instanceof Error ? err.message : 'Purchase failed — check your wallet and try again.');
            setTransactionResult('error');
        }
    };

    const handleBuy = async () => {
        if (selectedItem) await buyItem(selectedItem);
    };

    // ─── Complete-the-set: buy every missing piece of the active tab at once ───
    const handleCompleteSet = async (missing: MarketItem[], total: number) => {
        if (!wallet || missing.length === 0 || !hasEnoughFor(total)) return;
        setIsProcessing(true);
        setTransactionResult(null);
        setErrorNote('');
        try {
            await sendPurchase(missing.map(item => item.id), currency);

            let next = ownedIds;
            const now = 'Just now';
            const boughtIds = new Set(missing.map(m => m.id));
            for (const m of missing) next = addOwned(wallet, m.id);
            window.dispatchEvent(new CustomEvent('ludo-profile-refresh'));
            setOwnedIds(next);
            setMarketData(prev => prev.map(item =>
                boughtIds.has(item.id)
                    ? {
                        ...item,
                        owned: true,
                        activity: [
                            {
                                event: 'Sale',
                                from: 'Market',
                                to: 'Player',
                                price: marketCurrencyDisplayValue(item.price, currency),
                                currency,
                                date: now,
                            },
                            ...item.activity,
                        ],
                    }
                    : item,
            ));
            setIsProcessing(false);
            getSoundEngine().play('marketplace_purchase');
            setSuccessNote(`${missing.length} piece${missing.length > 1 ? 's' : ''} added — set complete.`);
            setTransactionResult('success');
        } catch (err) {
            console.error('❌ [Market] Complete-set failed:', err);
            setIsProcessing(false);
            getSoundEngine().play('ui_error');
            setErrorNote(err instanceof Error ? err.message : 'Complete-set failed — try again.');
            setTransactionResult('error');
        }
    };

    // ─── Listing ───
    const handleConfirmListing = async () => {
        if (!selectedItem || !sellPrice) return;
        setIsProcessing(true);
        setTransactionResult(null);
        setErrorNote('');

        await new Promise(resolve => setTimeout(resolve, 1500));

        const priceNum = parseFloat(sellPrice);
        setMarketData(prev => prev.map(item => {
            if (item.id === selectedItem.id) {
                const newActivity: MarketActivity = {
                    event: 'List',
                    from: 'Player',
                    to: 'Market',
                    price: priceNum,
                    currency: sellCurrency,
                    duration: listingDuration === '7d' ? '7 Days' : listingDuration === '30d' ? '30 Days' : 'Indefinite',
                    date: 'Just now',
                };
                return { ...item, activity: [newActivity, ...item.activity] };
            }
            return item;
        }));

        setIsProcessing(false);
        setSuccessNote(`${selectedItem.name} listed for ${formatCustomCurrencyAmount(priceNum, sellCurrency)}.`);
        setTransactionResult('success');
    };

    // ─── Close inspect ───
    const handleCloseDetail = () => {
        setSelectedItem(null);
        setIsSelling(false);
        setSellPrice('');
        setIsProcessing(false);
        setTransactionResult(null);
        setSuccessNote('');
        setErrorNote('');
    };

    // ─── Derived: counts, filtering, sorting, set progress ───
    const counts = useMemo(() => {
        const c = {} as Record<MarketTab, { total: number; owned: number }>;
        for (const t of TAB_META) {
            const items = marketData.filter(i => i.type === t.id);
            c[t.id] = { total: items.length, owned: items.filter(i => ownedIds.includes(i.id)).length };
        }
        return c;
    }, [marketData, ownedIds]);

    const totalOwned = TAB_META.reduce((n, t) => n + counts[t.id].owned, 0);

    const visibleItems = useMemo(() => {
        const q = search.trim().toLowerCase();
        let items = marketData.filter(i => i.type === activeTab);
        if (mode === 'loadout') items = items.filter(i => ownedIds.includes(i.id));
        else if (statusFilter === 'sale') items = items.filter(i => !ownedIds.includes(i.id));
        else if (statusFilter === 'owned') items = items.filter(i => ownedIds.includes(i.id));
        if (rarityFilter !== 'all') items = items.filter(i => i.rarity === rarityFilter);
        if (q) {
            items = items.filter(item =>
                item.name.toLowerCase().includes(q) ||
                item.collection.toLowerCase().includes(q) ||
                item.traits.some(t => t.value.toLowerCase().includes(q) || t.trait_type.toLowerCase().includes(q)),
            );
        }
        const sorted = [...items];
        if (sort === 'price-asc') sorted.sort((a, b) => a.price - b.price);
        else if (sort === 'price-desc') sorted.sort((a, b) => b.price - a.price);
        else if (sort === 'rarity') sorted.sort((a, b) => RARITY_RANK[b.rarity] - RARITY_RANK[a.rarity]);
        return sorted;
    }, [marketData, ownedIds, activeTab, mode, statusFilter, rarityFilter, search, sort]);

    const tabItems = useMemo(() => marketData.filter(i => i.type === activeTab), [marketData, activeTab]);
    const missing = useMemo(() => tabItems.filter(i => !ownedIds.includes(i.id)), [tabItems, ownedIds]);
    const missingTotal = missing.reduce((n, i) => n + i.price, 0);
    const cheapestMissing = missing.length ? [...missing].sort((a, b) => a.price - b.price)[0] : null;

    const lastSale = (item: MarketItem) => {
        const s = item.activity.find(a => a.event === 'Sale' && typeof a.price === 'number');
        return s?.price;
    };

    const activeFilterCount = (mode === 'market' && statusFilter !== 'all' ? 1 : 0) + (rarityFilter !== 'all' ? 1 : 0);

    // Active loadout slots (loadout mode header strip)
    const loadoutSlots = useMemo(() => {
        const find = (kind: MarketItem['kind'], val: string) =>
            marketData.find(i => i.kind === kind && i.equipValue === val);
        return [
            { label: 'Theme', tab: 'themes' as MarketTab, item: find('theme', preferences.theme) },
            { label: 'Dice', tab: 'dices' as MarketTab, item: find('dice', preferences.diceStyle) },
            { label: 'Token', tab: 'tokens' as MarketTab, item: find('tokens', preferences.tokenStyle) },
        ];
    }, [marketData, preferences]);

    /** Explicit art direction per context: px = exact render size, no fragile scale wrappers */
    const itemPreview = (item: MarketItem, px = 44) => {
        if (item.type === 'dices' && item.previewIcon) {
            const skin = item.id === 'dice-midnight'
                ? { face: '#0b1220', pip: '#22d3ee' }
                : item.id === 'dice-gold'
                    ? { face: '#451a03', pip: '#fcd34a' }
                    : { face: '#ffffff', pip: '#0F172A' };
            return (
                <div className="-rotate-6">
                    <DicePreview face={skin.face} pip={skin.pip} box={px} />
                </div>
            );
        }
        if (item.type === 'tokens' && item.id === 'tokens-orb') return <OrbPreview size={px} />;
        if (item.type === 'tokens') {
            return (
                <img
                    loading="lazy"
                    decoding="async"
                    src="/tokens/king.png"
                    alt={item.name}
                    width={px}
                    height={px}
                    style={{ width: px, height: px, objectFit: 'contain' }}
                />
            );
        }
        if (item.type === 'themes') return <ThemeSwatch mode={item.equipValue as '3077' | 'retro' | 'light'} size={px} />;
        if (item.kind === 'item') return <ItemRelic px={px} tint={item.previewColor} />;
        return item.previewIcon ?? null;
    };

    /** Rarity halo + pedestal shadow shared by cards and hero */
    const previewStage = (haloPx: string, rarity: Rarity) => (
        <>
            <div
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full blur-2xl pointer-events-none"
                style={{ width: haloPx, height: haloPx, background: RARITY_HALO[rarity] }}
            />
            <div className="absolute bottom-[16%] left-1/2 -translate-x-1/2 w-[58%] h-[10px] rounded-full bg-black/55 blur-[6px] pointer-events-none" />
        </>
    );

    const switchMode = (m: Mode) => {
        setMode(m);
        setSearch('');
        setStatusFilter('all');
        setRarityFilter('all');
    };

    const openSell = (item: MarketItem) => {
        setSelectedItem(item);
        setSellCurrency(currency);
        setSellPrice('');
        setIsSelling(true);
    };

    if (!isOpen) return null;

    const rarityPillClass = (rarity: Rarity) => {
        if (rarity === 'legendary') return 'border-warn/50 text-warn bg-warn/15';
        if (rarity === 'rare') return 'border-accent/45 text-accent bg-accent-soft';
        return 'border-line-soft text-ink-muted bg-surface-recessed';
    };

    return (
        <GamePanelShell
            scopeClass="ludo-market-scope"
            bodyScroll={false}
            kicker="// ARMORY & LOADOUT"
            title={(
                <span className="inline-flex items-center gap-2">
                    <span className="hud-chamfer-sm w-6 h-6 rounded-lg bg-accent-soft border border-accent/35 flex items-center justify-center">
                        <ArmoryCrateIcon className="w-3.5 h-3.5 text-accent" />
                    </span>
                    <span>{selectedItem ? (isSelling ? 'List for Sale' : 'Inspect Asset') : 'Marketplace'}</span>
                </span>
            )}
            subtitle={(
                <span className="inline-flex items-center gap-2">
                    <span className="inline-flex items-center gap-1">
                        <TokenIcon />
                        <span className="font-bold text-accent tracking-wide">BASE SEPOLIA</span>
                    </span>
                    <span className="w-1 h-1 rounded-full bg-line-strong" />
                    <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-recessed border border-line-soft"
                        title={`Available ${currency} balance on Base Sepolia`}
                    >
                        <ChipsHexIcon className="w-3 h-3 text-accent shrink-0" active />
                        <span className="font-extrabold text-ink-strong tabular-nums">
                            {formatBalanceShort(activeBalanceWei, currency)} {currency}
                        </span>
                    </span>
                </span>
            )}
            onClose={onClose}
            hideOrbs
        >
            <div ref={panelRef} className="relative flex-1 min-h-0 flex flex-col overflow-hidden">
                {/* ─── Transaction overlays ─── */}
                {isProcessing && (
                    <div className="absolute inset-0 z-[100] flex flex-col items-center justify-center p-8 text-center bg-surface-panel/95 backdrop-blur-md">
                        <div className="mb-5">
                            <ThinkingOrb state="searching" size={64} tone="accent" label="Updating vault inventory" />
                        </div>
                        <h3 className="text-xl font-extrabold text-ink-strong mb-2 uppercase tracking-tight">Updating your vault</h3>
                        <p className="text-sm text-ink-muted max-w-[240px]">Writing to your inventory on Base Sepolia…</p>
                    </div>
                )}

                {transactionResult === 'success' && (
                    <div className="absolute inset-0 z-[100] flex flex-col items-center justify-center p-8 text-center bg-surface-panel/95 backdrop-blur-md">
                        <div className="w-20 h-20 bg-positive/15 border border-positive/35 rounded-full flex items-center justify-center mb-6 shadow-[0_0_40px_rgba(34,197,94,0.2)]">
                            <CheckGlyphIcon className="w-10 h-10 text-positive" />
                        </div>
                        <h3 className="text-2xl font-extrabold text-ink-strong mb-2 uppercase tracking-tight">Success!</h3>
                        <p className="text-ink-muted mb-8 max-w-[260px] text-sm">{successNote || 'Done.'}</p>
                        <div className="w-full max-w-[280px]">
                            <Button variant="primary" size="lg" fullWidth onClick={handleCloseDetail} className="uppercase">
                                CONTINUE
                            </Button>
                        </div>
                    </div>
                )}

                {/* ─── Browse view (Store vs Loadout) ─── */}
                {!selectedItem ? (
                    <>
                        {/* Mode switcher: STORE vs LOADOUT */}
                        <div className="px-5 pt-3 relative z-10 shrink-0">
                            <PanelTabs
                                value={mode}
                                onPick={switchMode}
                                options={[
                                    { value: 'market', label: 'Store', badge: <TabCount active={mode === 'market'}>{marketData.length}</TabCount> },
                                    { value: 'loadout', label: 'Loadout', badge: <TabCount active={mode === 'loadout'}>{totalOwned}</TabCount> },
                                ]}
                            />
                        </div>

                        {/* Category rail */}
                        <div className="px-5 pt-3 relative z-10 shrink-0">
                            <div ref={railRef} className="market-cat-rail flex gap-2 w-full">
                                {TAB_META.map(t => {
                                    const active = activeTab === t.id;
                                    const n = mode === 'loadout' ? counts[t.id].owned : counts[t.id].total;
                                    return (
                                        <Chip
                                            key={t.id}
                                            ref={active ? activeChipRef : undefined}
                                            type="filter"
                                            active={active}
                                            onClick={() => setActiveTab(t.id)}
                                            className="chip-market flex-1 min-w-0 justify-center whitespace-nowrap"
                                        >
                                            <span className={`market-chip-icon shrink-0 ${active ? 'is-active' : ''}`}>{t.icon}</span>
                                            {t.label}
                                            <span className={`market-chip-count shrink-0 px-1.5 rounded-md text-ludo-xs font-mono ${active ? 'is-active' : ''}`}>{n}</span>
                                        </Chip>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Payment currency toggle: CHIPS / USDC / ETH on Base Sepolia */}
                        <div className="px-5 pt-2.5 relative z-10 shrink-0 flex items-center justify-between gap-2">
                            <span className="text-ludo-xs font-extrabold uppercase tracking-widest text-ink-faint">Pay with</span>
                            <div className="inline-flex items-center gap-1 p-0.5 rounded-xl bg-surface-recessed border border-line-soft">
                                {MARKET_CURRENCIES.map((cur) => {
                                    const active = currency === cur;
                                    return (
                                        <button
                                            key={cur}
                                            type="button"
                                            onClick={() => setCurrency(cur)}
                                            className={`px-2.5 py-1 rounded-lg text-ludo-xs font-extrabold uppercase tracking-wider transition-colors ${active ? 'bg-accent text-accent-ink shadow-sm' : 'text-ink-muted hover:text-ink-strong'}`}
                                        >
                                            {cur}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Toolbar: search / sort / filter / density */}
                        <div className="px-5 pt-3 relative z-10 shrink-0">
                            <div className="flex items-stretch gap-1.5">
                                <div className="search-shell flex w-[124px] items-center gap-1.5 bg-surface-recessed border border-line-soft rounded-lg pl-2 pr-1 h-9 focus-within:border-accent/60 transition-colors overflow-hidden">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="w-3.5 h-3.5 shrink-0 text-ink-faint">
                                        <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.5" y2="16.5" />
                                    </svg>
                                    <textarea
                                        value={search}
                                        rows={1}
                                        onChange={e => setSearch(e.target.value)}
                                        placeholder="Search"
                                        autoComplete="off"
                                        autoCorrect="off"
                                        autoCapitalize="none"
                                        spellCheck={false}
                                        enterKeyHint="search"
                                        className="flex-1 min-w-0 resize-none overflow-hidden bg-transparent border-0 p-0 text-ludo-sm font-bold text-ink-strong placeholder:text-ink-faint outline-none focus:outline-none focus-visible:outline-none focus:ring-0 shadow-none"
                                    />
                                    {search && (
                                        <button
                                            onClick={() => setSearch('')}
                                            className="shrink-0 w-5 h-5 flex items-center justify-center rounded-full bg-surface-hover text-ink-muted hover:text-ink-strong"
                                            aria-label="Clear search"
                                        >
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="w-2.5 h-2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                                        </button>
                                    )}
                                </div>

                                <div className="relative flex-1 min-w-0">
                                    <select
                                        value={sort}
                                        onChange={e => setSort(e.target.value as SortKey)}
                                        className="appearance-none w-full h-9 bg-surface-recessed border border-line-soft rounded-lg pl-2 pr-6 text-ludo-sm font-bold text-ink-strong truncate focus:outline-none focus:border-accent/60 transition-colors"
                                        aria-label="Sort items"
                                    >
                                        {(Object.keys(SORT_LABELS) as SortKey[]).map(k => (
                                            <option key={k} value={k} className="bg-surface-panel text-ink-strong">{SORT_LABELS[k]}</option>
                                        ))}
                                    </select>
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3 h-3 absolute right-1.5 top-1/2 -translate-y-1/2 text-ink-muted pointer-events-none"><polyline points="6 9 12 15 18 9" /></svg>
                                </div>

                                <button
                                    onClick={() => setFilterOpen(true)}
                                    className={`relative shrink-0 w-9 h-9 rounded-lg border flex items-center justify-center transition-colors ${activeFilterCount > 0 ? 'border-accent/60 bg-accent-soft text-accent' : 'border-line-soft bg-surface-recessed text-ink-muted hover:text-ink-strong'}`}
                                    aria-label="Open filters"
                                >
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="w-[18px] h-[18px]"><line x1="4" y1="6" x2="20" y2="6" /><line x1="7" y1="12" x2="17" y2="12" /><line x1="10" y1="18" x2="14" y2="18" /></svg>
                                    {activeFilterCount > 0 && (
                                        <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-accent text-accent-ink text-ludo-xs font-extrabold flex items-center justify-center">
                                            {activeFilterCount}
                                        </span>
                                    )}
                                </button>

                                <div className="flex shrink-0 items-center h-9 bg-surface-recessed border border-line-soft rounded-lg p-0.5 gap-0.5">
                                    {(['comfort', 'compact'] as const).map(d => (
                                        <button
                                            key={d}
                                            onClick={() => setDensity(d)}
                                            className={`shrink-0 h-full aspect-square rounded-md flex items-center justify-center transition-colors ${density === d ? 'bg-surface-active text-ink-strong' : 'text-ink-muted hover:text-ink-strong hover:bg-surface-hover'}`}
                                            aria-label={d === 'comfort' ? 'Comfortable grid' : 'Compact grid'}
                                        >
                                            {d === 'comfort' ? (
                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-[18px] h-[18px]"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
                                            ) : (
                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-[18px] h-[18px]"><rect x="3" y="3" width="5" height="5" rx="1" /><rect x="10" y="3" width="5" height="5" rx="1" /><rect x="17" y="3" width="5" height="5" rx="1" /><rect x="3" y="10" width="5" height="5" rx="1" /><rect x="10" y="10" width="5" height="5" rx="1" /><rect x="17" y="10" width="5" height="5" rx="1" /><rect x="3" y="17" width="5" height="5" rx="1" /><rect x="10" y="17" width="5" height="5" rx="1" /><rect x="17" y="17" width="5" height="5" rx="1" /></svg>
                                            )}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="mt-2.5 mb-0.5">
                                <HudSectionLabel
                                    right={mode === 'loadout' ? <span className="text-ludo-xs font-bold uppercase tracking-widest text-ink-faint">in your vault</span> : undefined}
                                >
                                    {visibleItems.length} {visibleItems.length === 1 ? 'PIECE' : 'PIECES'}
                                </HudSectionLabel>
                            </div>
                        </div>

                        {/* Scrollable grid */}
                        <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar pt-2 px-5 mb-2 relative z-10">
                            {visibleItems.length === 0 ? (
                                <div className="flex flex-col items-center justify-center text-center py-14 px-6">
                                    <div className="w-16 h-16 rounded-2xl bg-surface-recessed border border-line-soft flex items-center justify-center mb-4 text-ink-faint">
                                        {TAB_META.find(t => t.id === activeTab)?.icon}
                                    </div>
                                    <h3 className="text-ink-strong font-extrabold text-sm mb-1">
                                        {mode === 'loadout' ? `No ${activeTab} in your vault yet` : 'Nothing matches those filters'}
                                    </h3>
                                    <p className="text-ink-muted text-xs mb-5 max-w-[220px]">
                                        {mode === 'loadout'
                                            ? 'Grab gear from the store — anything you buy lands here, ready to equip.'
                                            : 'Try a different search or clear the active filters.'}
                                    </p>
                                    {mode === 'loadout' ? (
                                        <Button variant="secondary" size="md" onClick={() => switchMode('market')} className="px-5 uppercase tracking-widest">
                                            Browse store
                                        </Button>
                                    ) : (
                                        <Button variant="secondary" size="md" onClick={() => { setSearch(''); setStatusFilter('all'); setRarityFilter('all'); }} className="px-5 uppercase tracking-widest">
                                            Clear filters
                                        </Button>
                                    )}
                                </div>
                            ) : (
                                <div className={`grid ${density === 'comfort' ? 'grid-cols-2 gap-3' : 'grid-cols-3 gap-2'} pb-2`}>
                                    {visibleItems.map(item => {
                                        const owned = isOwnedId(item.id);
                                        const equipped = isEquipped(item);
                                        const isLoadout = mode === 'loadout';
                                        const showcased = showcasedId === item.id;
                                        const marked = isLoadout && (equipped || showcased);
                                        // Quick action: store is BUY/SELL only, loadout is ACTIVATE/SHOWCASE only.
                                        const quickLabel = !isLoadout
                                            ? (owned ? 'SELL' : `BUY · ${formatCurrencyCompact(item.price, currency)}`)
                                            : (item.equipValue ? (equipped ? null : 'ACTIVATE') : (showcased ? null : 'SHOWCASE'));
                                        const runQuick = (e: React.MouseEvent) => {
                                            e.stopPropagation();
                                            if (!isLoadout) {
                                                if (!owned) {
                                                    // Broke? Fall through to inspect where the shortfall is explained.
                                                    if (wallet && hasEnoughFor(item.price)) buyItem(item);
                                                    else setSelectedItem(item);
                                                } else openSell(item);
                                            } else if ((item.equipValue && !equipped) || (!item.equipValue && !showcased)) {
                                                setConfirmItem(item);
                                            }
                                        };
                                        const onTap = () => {
                                            if (isLoadout && ((item.equipValue && !equipped) || (!item.equipValue && !showcased))) setConfirmItem(item);
                                            else setSelectedItem(item);
                                        };
                                        return (
                                            <div
                                                key={item.id}
                                                onClick={onTap}
                                                className={`card-3077 group relative rounded-2xl bg-surface-panel border border-line-soft overflow-hidden cursor-pointer transition-all hover:border-line-strong hover:bg-surface-hover active:scale-[0.98] ${marked ? 'ring-1 ring-positive/60 shadow-[0_0_20px_rgba(74,222,128,0.16)]' : ''}`}
                                            >
                                                {/* rarity beam */}
                                                <div className={`absolute left-0 top-3 bottom-3 w-[3px] rounded-full z-20 ${RARITY_BEAM[item.rarity]}`} />
                                                {/* preview stage: halo + pedestal + oversized art */}
                                                <div className={`relative ${item.previewColor} aspect-[5/4] flex items-center justify-center overflow-hidden`}>
                                                    <div
                                                        className="absolute inset-0 pointer-events-none"
                                                        style={{ background: 'radial-gradient(circle at 50% 30%, rgba(255,255,255,0.12), transparent 65%)' }}
                                                    />
                                                    <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/45 pointer-events-none" />
                                                    {item.rarity === 'legendary' && <div className="absolute inset-0 bg-warn/10 pointer-events-none" />}
                                                    {previewStage(density === 'comfort' ? '120px' : '88px', item.rarity)}
                                                    {/* rarity sigil */}
                                                    <div className={`absolute top-2 left-2.5 z-20 rounded-md flex items-center justify-center font-extrabold backdrop-blur-sm border ${density === 'comfort' ? 'w-5 h-5 text-ludo-xs' : 'w-4 h-4 text-ludo-xs'} ${rarityPillClass(item.rarity)}`}>
                                                        {item.rarity === 'common' ? 'C' : item.rarity === 'rare' ? 'R' : 'L'}
                                                    </div>
                                                    <div className="relative z-10 transition-transform duration-300 group-hover:scale-110 group-hover:-translate-y-0.5 drop-shadow-[0_10px_16px_rgba(0,0,0,0.5)]">
                                                        {itemPreview(item, density === 'comfort' ? 76 : 60)}
                                                    </div>
                                                    {/* store: tiny owned badge */}
                                                    {!isLoadout && owned && (
                                                        <div className="absolute top-2 right-2 z-20 px-1.5 py-0.5 rounded-md bg-surface-panel/90 border border-line-soft backdrop-blur-sm text-ludo-xs font-extrabold tracking-[0.14em] text-ink-strong">
                                                            OWNED
                                                        </div>
                                                    )}
                                                    {/* loadout mark: active gear or showcased relic */}
                                                    {marked && (
                                                        <>
                                                            <div className="absolute bottom-2 left-2 z-20 px-2 py-0.5 rounded-full bg-positive/20 border border-positive/60 text-positive text-ludo-xs font-extrabold uppercase tracking-[0.14em] shadow-lg whitespace-nowrap backdrop-blur-sm">
                                                                {equipped ? 'Active' : 'Showcasing'}
                                                            </div>
                                                            <div className="porcelain-holo-tick absolute top-2 right-2 w-5 h-5 rounded-full bg-positive flex items-center justify-center shadow-lg z-20">
                                                                <CheckGlyphIcon className="w-3 h-3 text-accent-ink" />
                                                            </div>
                                                        </>
                                                    )}
                                                </div>
                                                {/* body: title + price */}
                                                <div className={density === 'comfort' ? 'p-3' : 'p-2'}>
                                                    <h3 className={`font-extrabold text-ink-strong ${density === 'comfort' ? 'text-ludo-md leading-tight line-clamp-2 min-h-[2.1em]' : 'text-ludo-sm truncate'}`}>
                                                        {item.name}
                                                    </h3>
                                                    <div className="flex items-center gap-1 mt-1">
                                                        <ChipsHexIcon className="w-3.5 h-3.5 text-accent shrink-0" active />
                                                        <span className={`font-extrabold text-ink-strong font-mono tabular-nums truncate ${density === 'comfort' ? 'text-ludo-md' : 'text-ludo-sm'}`}>
                                                            {formatCurrencyCompact(item.price, currency)}
                                                        </span>
                                                    </div>
                                                </div>
                                                {/* hover quick-action rail */}
                                                {quickLabel && (
                                                    <div className="absolute inset-x-0 bottom-0 z-20 translate-y-[102%] group-hover:translate-y-0 group-focus-within:translate-y-0 transition-transform duration-200">
                                                        <Button
                                                            variant="secondary" size="sm" fullWidth onClick={runQuick}
                                                            className="rounded-none tracking-[0.16em] uppercase"
                                                        >
                                                            {quickLabel}
                                                        </Button>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Set-completion bar (store only) */}
                        {mode === 'market' && tabItems.length > 0 && (
                            <div className="px-5 pb-3 pt-1 relative z-10 shrink-0">
                                {missing.length === 0 ? (
                                    <div className="flex items-center gap-3 rounded-2xl border border-positive/35 bg-positive/10 px-4 py-2.5">
                                        <div className="w-8 h-8 rounded-full bg-positive/20 flex items-center justify-center shrink-0">
                                            <CheckGlyphIcon className="w-4 h-4 text-positive" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-xs font-extrabold text-positive uppercase tracking-[0.14em]">Set complete</div>
                                            <div className="text-ludo-sm font-bold text-ink-muted truncate">
                                                Every {TAB_SINGULAR[activeTab]} piece is yours. Flex accordingly.
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="relative rounded-2xl border border-line-soft bg-surface-recessed px-4 py-2.5 shadow-lg">
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className="shrink-0 text-ludo-xs font-extrabold uppercase tracking-[0.16em] text-ink-muted">
                                                {TAB_META.find(t => t.id === activeTab)?.label} set
                                            </span>
                                            <span className="shrink-0 px-1.5 py-0.5 rounded-md bg-surface-panel border border-line-soft text-ludo-xs font-extrabold font-mono text-ink-strong">
                                                {tabItems.length - missing.length}/{tabItems.length}
                                            </span>
                                            <div className="flex-1 min-w-0 text-right">
                                                {cheapestMissing && (
                                                    <span className="block truncate text-ludo-xs font-bold text-ink-faint">
                                                        next: <span className="text-ink-strong">{cheapestMissing.name}</span>
                                                        {' · '}<span className="text-warn font-mono">{formatCurrencyCompact(cheapestMissing.price, currency)}</span>
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <div className="flex-1 min-w-0">
                                                <HudProgressGauge
                                                    percent={((tabItems.length - missing.length) / tabItems.length) * 100}
                                                    tone="accent"
                                                />
                                                <div className="mt-1.5 text-ludo-xs font-bold text-ink-faint truncate">
                                                    {missing.length} to go · {formatMarketAmount(missingTotal, currency)} total
                                                </div>
                                            </div>
                                            <Button
                                                variant="primary" size="sm"
                                                onClick={() => handleCompleteSet(missing, missingTotal)}
                                                disabled={!wallet || !hasEnoughFor(missingTotal)}
                                                className="shrink-0 min-w-[92px] px-3 flex-col leading-tight shadow-md"
                                            >
                                                {hasEnoughFor(missingTotal) ? (
                                                    <>
                                                        <span className="text-ludo-sm font-extrabold uppercase tracking-[0.12em]">Complete</span>
                                                        <span className="text-ludo-xs font-bold font-mono opacity-80">{formatCurrencyCompact(missingTotal, currency)}</span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <span className="text-ludo-sm font-extrabold uppercase tracking-[0.12em]">Locked</span>
                                                        <span className="text-ludo-xs font-bold font-mono opacity-80">need {shortfallText(missingTotal)}</span>
                                                    </>
                                                )}
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </>
                ) : !isSelling ? (
                    /* ─── Inspect detail view ─── */
                    (() => {
                        const owned = isOwnedId(selectedItem.id);
                        const equipped = isEquipped(selectedItem);
                        const showcased = showcasedId === selectedItem.id;
                        const isLoadout = mode === 'loadout';
                        const sale = lastSale(selectedItem);
                        const canAfford = hasEnoughFor(selectedItem.price);
                        const liveTheme = marketData.find(i => i.kind === 'theme' && i.equipValue === preferences.theme);
                        const liveDice = marketData.find(i => i.kind === 'dice' && i.equipValue === preferences.diceStyle);
                        const liveTokens = marketData.find(i => i.kind === 'tokens' && i.equipValue === preferences.tokenStyle);
                        const inMatch: { label: string; value: string; live: boolean }[] = (() => {
                            if (selectedItem.kind === 'theme') return [
                                { label: 'Role', value: 'Arena skin — board, panels, ambient glow', live: false },
                                { label: 'Wearing now', value: liveTheme ? liveTheme.name : '—', live: true },
                                { label: 'Swap', value: 'Instant, anytime — even mid-session', live: false },
                            ];
                            if (selectedItem.kind === 'dice') return [
                                { label: 'Role', value: 'Your roll — every turn you take', live: false },
                                { label: 'Rolling now', value: liveDice ? liveDice.name : '—', live: true },
                                { label: 'Odds', value: 'Cosmetic only — never touches the RNG', live: false },
                            ];
                            if (selectedItem.kind === 'tokens') return [
                                { label: 'Role', value: 'Your pawns — all four carry it', live: false },
                                { label: 'Wearing now', value: liveTokens ? liveTokens.name : '—', live: true },
                                { label: 'Ranks', value: 'Chess set evolves Pawn → King with progress', live: false },
                            ];
                            return [
                                { label: 'Role', value: 'Vault relic — prestige, no in-match effect', live: false },
                                { label: 'Showcasing', value: showcasedId ? (marketData.find(i => i.id === showcasedId)?.name ?? '—') : 'None yet', live: true },
                                { label: 'Rarity check', value: `${selectedItem.collectionStats.owners.toLocaleString()} owners hold this collection`, live: false },
                            ];
                        })();
                        const statusLive = equipped || showcased;

                        return (
                            <>
                                {/* Sub-bar: Back + rarity */}
                                <div className="flex items-center justify-between py-2.5 px-5 border-b border-line-soft bg-surface-recessed/70 shrink-0">
                                    <Button variant="ghost" size="sm" onClick={handleCloseDetail} aria-label="Back to catalog">
                                        <span className="inline-flex items-center gap-1.5 text-ink-strong">
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
                                            Back
                                        </span>
                                    </Button>
                                    <span className={`px-2.5 py-1 rounded-full text-ludo-xs font-extrabold uppercase tracking-widest border ${rarityPillClass(selectedItem.rarity)}`}>
                                        {selectedItem.rarity}
                                    </span>
                                </div>

                                <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-5 pb-6">
                                    {/* Hero */}
                                    <div className={`relative mt-4 rounded-3xl ${selectedItem.previewColor} border border-line-soft overflow-hidden`}>
                                        <HudCornerTicks />
                                        <div
                                            className="absolute inset-0 pointer-events-none"
                                            style={{ background: 'radial-gradient(circle at 50% 28%, rgba(255,255,255,0.14), transparent 65%)' }}
                                        />
                                        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/55 pointer-events-none" />
                                        {previewStage('190px', selectedItem.rarity)}
                                        <div className="relative h-52 flex items-center justify-center">
                                            {itemPreview(selectedItem, selectedItem.type === 'themes' ? 104 : 88)}
                                        </div>
                                        {isLoadout && (equipped || showcased) && (
                                            <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-positive/25 border border-positive/60 text-positive text-ludo-xs font-extrabold uppercase tracking-widest shadow-lg backdrop-blur-sm">
                                                {equipped ? 'Active' : 'Showcasing'}
                                            </div>
                                        )}
                                        {!isLoadout && owned && (
                                            <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-surface-panel/90 border border-line-soft text-ink-strong text-ludo-xs font-extrabold uppercase tracking-widest shadow-lg backdrop-blur-sm">
                                                Owned
                                            </div>
                                        )}
                                    </div>

                                    {/* Title */}
                                    <div className="mt-4">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="text-ludo-xs text-ink-faint font-bold uppercase tracking-wider">{selectedItem.collection}</span>
                                            <span className="w-1 h-1 bg-line-strong rounded-full" />
                                            <span className="text-ludo-xs text-accent font-bold">@{selectedItem.creator}</span>
                                        </div>
                                        <h1 className="text-2xl font-extrabold text-ink-strong">{selectedItem.name}</h1>
                                        <p className="text-ink-muted text-ludo-md leading-relaxed mt-1.5">{selectedItem.description}</p>
                                    </div>

                                    {/* In match */}
                                    <div className="mt-4 rounded-2xl border border-accent/25 bg-accent-soft/40 p-4">
                                        <div className="flex items-center justify-between mb-2">
                                            <h4 className="text-ludo-xs text-accent font-extrabold uppercase tracking-widest">In match</h4>
                                            <span className="flex items-center gap-1.5">
                                                <span className={`w-1.5 h-1.5 rounded-full ${statusLive ? 'bg-positive shadow-[0_0_8px_rgba(74,222,128,0.8)]' : owned ? 'bg-warn shadow-[0_0_8px_rgba(251,191,36,0.8)]' : 'bg-line-strong'}`} />
                                                <span className="text-ludo-xs font-extrabold uppercase tracking-widest text-ink-muted">
                                                    {statusLive ? 'Live' : owned ? 'In vault' : 'Not owned'}
                                                </span>
                                            </span>
                                        </div>
                                        <div className="flex flex-col gap-2">
                                            {inMatch.map((row, i) => (
                                                <div key={i} className="flex items-start justify-between gap-3">
                                                    <span className="text-ludo-xs font-bold text-ink-faint uppercase tracking-wider shrink-0">{row.label}</span>
                                                    <span className={`text-ludo-sm font-bold text-right leading-snug ${row.live ? 'text-accent' : 'text-ink-strong'}`}>{row.value}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Price box */}
                                    <div className="mt-4 rounded-2xl border border-line-soft bg-surface-recessed p-4">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="text-ludo-xs text-ink-faint font-extrabold uppercase tracking-widest">{owned ? 'You own this' : 'Price'}</span>
                                            <div className="inline-flex items-center gap-1 p-0.5 rounded-lg bg-surface-panel border border-line-soft">
                                                {MARKET_CURRENCIES.map((cur) => {
                                                    const active = currency === cur;
                                                    return (
                                                        <button
                                                            key={cur}
                                                            type="button"
                                                            onClick={() => setCurrency(cur)}
                                                            className={`px-2 py-0.5 rounded-md text-ludo-xs font-extrabold uppercase tracking-wider transition-colors ${active ? 'bg-accent text-accent-ink' : 'text-ink-muted hover:text-ink-strong'}`}
                                                        >
                                                            {cur}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                        <div className="flex items-baseline justify-between gap-2 mt-2">
                                            <div className="flex items-center gap-2">
                                                <ChipsHexIcon className="w-4 h-4 text-accent shrink-0" active />
                                                <span className="porcelain-hero text-3xl font-extrabold text-ink-strong font-mono tabular-nums">
                                                    {formatMarketAmount(selectedItem.price, currency).split(' ')[0]}
                                                </span>
                                                <span className="text-sm font-bold text-ink-muted">{currency}</span>
                                            </div>
                                            {sale !== undefined && (
                                                <span className="text-ludo-xs font-bold text-ink-faint font-mono">
                                                    last sale {sale.toLocaleString()}
                                                </span>
                                            )}
                                        </div>
                                        <div className="mt-2 flex items-center justify-between text-ludo-xs font-bold text-ink-muted">
                                            <span>Base Sepolia Balance</span>
                                            <span className="font-mono text-ink-strong tabular-nums">
                                                {formatBalanceShort(activeBalanceWei, currency)} {currency}
                                            </span>
                                        </div>
                                        {!owned && !canAfford && (
                                            <p className="mt-1.5 text-ludo-sm font-bold text-negative">
                                                You need {shortfallText(selectedItem.price)} more on Base Sepolia.
                                            </p>
                                        )}
                                        {transactionResult === 'error' && (
                                            <p className="mt-1.5 text-ludo-sm font-bold text-negative">
                                                {errorNote || 'Purchase failed — check your connection and try again.'}
                                            </p>
                                        )}
                                    </div>

                                    {/* Traits */}
                                    {selectedItem.traits.length > 0 && (
                                        <div className="mt-5">
                                            <h4 className="text-ludo-xs text-ink-faint font-extrabold uppercase tracking-widest mb-2">Properties</h4>
                                            <div className="grid grid-cols-3 gap-2">
                                                {selectedItem.traits.map((trait, i) => (
                                                    <div key={i} className="bg-surface-recessed border border-accent/25 rounded-xl p-2.5 flex flex-col items-center text-center">
                                                        <span className="text-ludo-xs text-accent font-extrabold uppercase mb-0.5">{trait.trait_type}</span>
                                                        <span className="text-ludo-xs text-ink-strong font-bold mb-1 truncate w-full">{trait.value}</span>
                                                        <span className="text-ludo-xs text-ink-muted font-mono">{trait.rarity_percent}%</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Lore */}
                                    <div className="mt-4 rounded-2xl bg-accent-soft/25 border border-accent/20 p-4">
                                        <h4 className="text-ludo-xs text-accent font-extrabold uppercase tracking-widest mb-1.5">Item Lore</h4>
                                        <p className="text-xs text-ink-muted italic leading-relaxed">{selectedItem.lore}</p>
                                    </div>

                                    {/* Activity */}
                                    {selectedItem.activity.length > 0 && (
                                        <div className="mt-5">
                                            <h4 className="text-ludo-xs text-ink-faint font-extrabold uppercase tracking-widest mb-2">Activity</h4>
                                            <div className="bg-surface-recessed border border-line-soft rounded-2xl overflow-hidden text-ludo-xs">
                                                {selectedItem.activity.slice(0, 5).map((act, i) => (
                                                    <div key={i} className={`flex items-center justify-between px-4 py-3 ${i !== 0 ? 'border-t border-line-soft' : ''}`}>
                                                        <div className="flex items-center gap-2">
                                                            <span className={`w-1.5 h-1.5 rounded-full ${act.event === 'Created' ? 'bg-positive' : act.event === 'Sale' ? 'bg-accent' : act.event === 'List' ? 'bg-warn' : 'bg-line-strong'}`} />
                                                            <span className="text-ink-strong font-bold">{act.event}</span>
                                                        </div>
                                                        <div className="flex items-center gap-2 font-mono text-ink-muted">
                                                            {act.price !== undefined && (
                                                                <span className="text-ink-strong font-bold">
                                                                    {act.price.toLocaleString(undefined, { maximumFractionDigits: 6 })} {act.currency ?? 'CHIPS'}
                                                                </span>
                                                            )}
                                                            <span className="text-ink-faint">{act.date}</span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Footer */}
                                <div className="px-5 py-4 border-t border-line-soft bg-surface-panel/95 backdrop-blur-md shrink-0">
                                    {!isLoadout ? (
                                        owned ? (
                                            <Button variant="primary" size="lg" fullWidth onClick={() => openSell(selectedItem)} className="uppercase">
                                                SELL
                                            </Button>
                                        ) : (
                                            <Button
                                                variant="primary" size="lg" fullWidth
                                                onClick={handleBuy}
                                                disabled={!canAfford || !wallet}
                                            >
                                                {!wallet ? 'CONNECT WALLET TO BUY' : `BUY · ${formatMarketAmount(selectedItem.price, currency)}`}
                                            </Button>
                                        )
                                    ) : selectedItem.equipValue ? (
                                        equipped ? (
                                            <div className="w-full py-3.5 rounded-2xl bg-positive/15 border border-positive/40 text-positive font-extrabold text-sm uppercase tracking-widest text-center">
                                                Active in matches
                                            </div>
                                        ) : (
                                            <Button variant="primary" size="lg" fullWidth onClick={() => setConfirmItem(selectedItem)} className="uppercase">
                                                ACTIVATE
                                            </Button>
                                        )
                                    ) : showcased ? (
                                        <div className="w-full py-3.5 rounded-2xl bg-positive/15 border border-positive/40 text-positive font-extrabold text-sm uppercase tracking-widest text-center">
                                            Showcasing in vault
                                        </div>
                                    ) : (
                                        <Button variant="primary" size="lg" fullWidth onClick={() => setConfirmItem(selectedItem)} className="uppercase">
                                            SHOWCASE
                                        </Button>
                                    )}
                                </div>
                            </>
                        );
                    })()
                ) : (
                    /* ─── Sell / List view ─── */
                    <>
                        <div className="flex items-center justify-between py-2.5 px-5 border-b border-line-soft bg-surface-recessed/70 shrink-0">
                            <Button variant="ghost" size="sm" onClick={() => setIsSelling(false)} aria-label="Back to inspect">
                                <span className="inline-flex items-center gap-1.5 text-ink-strong">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></svg>
                                    Back to inspect
                                </span>
                            </Button>
                            <span className="text-ludo-xs font-extrabold uppercase tracking-widest text-ink-faint">Marketplace Listing</span>
                        </div>

                        <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-5 pt-5 pb-6">
                            <div className="flex items-center gap-4 bg-surface-recessed p-4 rounded-2xl border border-line-soft mb-6">
                                <div className={`w-16 h-16 rounded-2xl ${selectedItem.previewColor} flex items-center justify-center shadow-lg border border-line-soft overflow-hidden shrink-0`}>
                                    {itemPreview(selectedItem, 36)}
                                </div>
                                <div className="min-w-0">
                                    <h4 className="text-sm font-extrabold text-ink-strong truncate">{selectedItem.name}</h4>
                                    <p className="text-ludo-xs text-ink-faint font-bold tracking-wider uppercase">{selectedItem.collection}</p>
                                </div>
                            </div>

                            <div className="mb-5">
                                <label className="text-ludo-xs text-ink-faint font-extrabold uppercase tracking-widest mb-2 block">Currency</label>
                                <div className="flex bg-surface-recessed p-1 rounded-2xl border border-line-soft gap-1">
                                    {MARKET_CURRENCIES.map(cur => (
                                        <Chip
                                            key={cur}
                                            type="filter"
                                            size="sm"
                                            active={sellCurrency === cur}
                                            onClick={() => setSellCurrency(cur)}
                                            className="flex-1 justify-center rounded-xl py-2.5 tracking-wider"
                                        >
                                            {cur}
                                        </Chip>
                                    ))}
                                </div>
                            </div>

                            <div className="mb-5">
                                <label className="text-ludo-xs text-ink-faint font-extrabold uppercase tracking-widest mb-2 block">Set price ({sellCurrency})</label>
                                <div className="relative">
                                    <input
                                        type="text"
                                        inputMode="decimal"
                                        autoComplete="off"
                                        autoCorrect="off"
                                        autoCapitalize="none"
                                        spellCheck={false}
                                        placeholder="0"
                                        value={sellPrice}
                                        onChange={e => setSellPrice(sanitizeDecimalInput(e.target.value))}
                                        className="w-full bg-surface-recessed border border-line-soft rounded-2xl p-5 pr-24 text-3xl font-mono font-extrabold text-ink-strong focus:outline-none focus:border-accent/60 transition-all placeholder:text-ink-faint"
                                    />
                                    <div className="absolute right-5 top-1/2 -translate-y-1/2 text-sm font-extrabold text-ink-faint uppercase">{sellCurrency}</div>
                                </div>
                            </div>

                            <div className="mb-6">
                                <label className="text-ludo-xs text-ink-faint font-extrabold uppercase tracking-widest mb-2 block">Duration</label>
                                <div className="flex bg-surface-recessed p-1 rounded-2xl border border-line-soft gap-1">
                                    {(['7d', '30d', 'indefinite'] as const).map(d => (
                                        <Chip
                                            key={d}
                                            type="filter"
                                            size="sm"
                                            active={listingDuration === d}
                                            onClick={() => setListingDuration(d)}
                                            className="flex-1 justify-center rounded-xl py-2.5 tracking-wider"
                                        >
                                            {d === '7d' ? '7 Days' : d === '30d' ? '30 Days' : 'No expiry'}
                                        </Chip>
                                    ))}
                                </div>
                            </div>

                            <div className="rounded-2xl border border-line-soft bg-surface-recessed p-4 mb-6">
                                <div className="flex justify-between text-ludo-sm font-medium mb-2">
                                    <span className="text-ink-muted">Marketplace fee</span>
                                    <span className="text-ink-strong font-mono">2.5%</span>
                                </div>
                                <div className="h-px bg-line-soft my-2" />
                                <div className="flex justify-between items-center">
                                    <span className="text-xs font-extrabold text-ink-strong uppercase tracking-wider">You receive</span>
                                    <span className="text-2xl font-extrabold font-mono text-positive">
                                        {sellPrice && Number(sellPrice) > 0
                                            ? formatCustomCurrencyAmount(Number(sellPrice) * 0.975, sellCurrency)
                                            : `0 ${sellCurrency}`}
                                    </span>
                                </div>
                            </div>

                            <Button
                                variant="primary" size="lg" fullWidth
                                onClick={handleConfirmListing}
                                disabled={!sellPrice || Number(sellPrice) <= 0}
                                className="uppercase"
                            >
                                CONFIRM LISTING
                            </Button>
                        </div>
                    </>
                )}

                {/* ─── Activation ritual drawer (loadout tap on inactive gear / unshowcased relic) ─── */}
                {confirmItem && (() => {
                    const isGear = !!confirmItem.equipValue;
                    const slotLabel = TAB_SINGULAR[confirmItem.type];
                    const verb = isGear ? 'Activate' : 'Showcase';
                    const currentGear = isGear ? loadoutSlots.find(s => s.tab === confirmItem.type)?.item : undefined;
                    const currentRelic = !isGear && showcasedId ? marketData.find(i => i.id === showcasedId) : undefined;
                    const current = isGear ? currentGear : currentRelic;
                    const swapping = current && current.id !== confirmItem.id;
                    return (
                        <div className="absolute inset-0 z-[125] flex flex-col justify-end">
                            <div className="absolute inset-0 bg-surface-page/75 backdrop-blur-[2px]" onClick={() => setConfirmItem(null)} />
                            <div className="relative rounded-t-[24px] border-t border-accent/35 bg-surface-panel p-5 pb-7 shadow-2xl">
                                <div className="w-10 h-1 rounded-full bg-line-strong mx-auto mb-4" />
                                <div className="text-center text-ludo-xs font-extrabold uppercase tracking-[0.24em] text-accent mb-4">
                                    {verb} {slotLabel}
                                </div>
                                {/* swap preview: current → incoming */}
                                <div className="flex items-center justify-center gap-4 mb-4">
                                    <div className="flex flex-col items-center gap-1.5">
                                        <div className={`w-14 h-14 rounded-2xl ${current?.previewColor ?? 'bg-surface-recessed'} border border-line-soft flex items-center justify-center overflow-hidden opacity-70`}>
                                            {current ? itemPreview(current, 34) : null}
                                        </div>
                                        <span className="text-ludo-xs font-bold text-ink-faint max-w-[72px] truncate">{current?.name ?? 'Empty'}</span>
                                    </div>
                                    <div className="flex flex-col items-center gap-1 pb-4">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-accent"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
                                        <span className="text-ludo-xs font-extrabold uppercase tracking-widest text-ink-faint">replaces</span>
                                    </div>
                                    <div className="flex flex-col items-center gap-1.5">
                                        <div className={`w-14 h-14 rounded-2xl ${confirmItem.previewColor} border border-accent/60 flex items-center justify-center overflow-hidden shadow-[0_0_24px_color-mix(in_srgb,var(--accent)_28%,transparent)]`}>
                                            {itemPreview(confirmItem, 34)}
                                        </div>
                                        <span className="text-ludo-xs font-extrabold text-ink-strong max-w-[72px] truncate">{confirmItem.name}</span>
                                    </div>
                                </div>
                                <p className="text-center text-ludo-sm font-bold text-ink-muted mb-4 px-4">
                                    {isGear ? (
                                        swapping ? (
                                            <>{confirmItem.name} becomes your active {slotLabel.toLowerCase()}. {current?.name} stays in your vault.</>
                                        ) : (
                                            <>{confirmItem.name} becomes your active {slotLabel.toLowerCase()}.</>
                                        )
                                    ) : (
                                        swapping ? (
                                            <>{confirmItem.name} becomes your showcased relic. Replaces {current?.name}.</>
                                        ) : (
                                            <>{confirmItem.name} becomes your showcased relic.</>
                                        )
                                    )}
                                </p>
                                <div className="flex gap-2">
                                    <Button
                                        variant="secondary" size="lg"
                                        onClick={() => setConfirmItem(null)}
                                        className="flex-1 uppercase tracking-widest"
                                    >
                                        Keep current
                                    </Button>
                                    <Button
                                        data-testid="confirm-activate"
                                        variant="primary" size="lg"
                                        onClick={confirmActivation}
                                        className="flex-1 uppercase tracking-widest"
                                    >
                                        {verb === 'Activate' ? 'ACTIVATE' : 'SHOWCASE'}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    );
                })()}

                {/* ─── Filter drawer ─── */}
                {filterOpen && (
                    <div className="absolute inset-0 z-[125] flex flex-col justify-end">
                        <div className="absolute inset-0 bg-surface-page/75 backdrop-blur-[2px]" onClick={() => setFilterOpen(false)} />
                        <div className="relative rounded-t-[24px] border-t border-line-strong bg-surface-panel p-5 pb-8 shadow-2xl">
                            <div className="w-10 h-1 rounded-full bg-line-strong mx-auto mb-4" />
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-base font-extrabold text-ink-strong uppercase tracking-wide">Filters</h3>
                                <Button variant="ghost" size="sm" onClick={() => { setStatusFilter('all'); setRarityFilter('all'); }} className="text-accent uppercase tracking-widest">
                                    Clear all
                                </Button>
                            </div>
                            {mode === 'market' && (
                                <div className="mb-4">
                                    <div className="text-ludo-xs font-extrabold uppercase tracking-widest text-ink-faint mb-2">Status</div>
                                    <div className="flex gap-2">
                                        {([['all', 'All'], ['sale', 'For sale'], ['owned', 'Owned by you']] as [StatusFilter, string][]).map(([v, label]) => (
                                            <Chip
                                                key={v}
                                                type="filter"
                                                size="sm"
                                                active={statusFilter === v}
                                                onClick={() => setStatusFilter(v)}
                                                className="flex-1 justify-center rounded-xl py-2.5 text-xs"
                                            >
                                                {label}
                                            </Chip>
                                        ))}
                                    </div>
                                </div>
                            )}
                            <div className="mb-5">
                                <div className="text-ludo-xs font-extrabold uppercase tracking-widest text-ink-faint mb-2">Rarity</div>
                                <div className="flex gap-2">
                                    {([['all', 'All'], ['common', 'Common'], ['rare', 'Rare'], ['legendary', 'Legendary']] as ['all' | Rarity, string][]).map(([v, label]) => (
                                        <Chip
                                            key={v}
                                            type="filter"
                                            size="sm"
                                            active={rarityFilter === v}
                                            onClick={() => setRarityFilter(v)}
                                            className="flex-1 justify-center rounded-xl py-2.5 text-xs"
                                        >
                                            {label}
                                        </Chip>
                                    ))}
                                </div>
                            </div>
                            <Button variant="primary" size="lg" fullWidth onClick={() => setFilterOpen(false)} className="uppercase tracking-wide">
                                Show {visibleItems.length} {visibleItems.length === 1 ? 'piece' : 'pieces'}
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </GamePanelShell>
    );
}
