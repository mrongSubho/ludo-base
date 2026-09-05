'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { usePreferences } from '@/hooks/usePreferences';
import { supabase } from '@/lib/supabase';
import { getOwned, addOwned } from '@/lib/inventory';
import { getShowcased, setShowcased } from '@/lib/showcase';
import { useGuestWall } from '@/hooks/GuestWallContext';

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

// ─── Token Icon ───────────────────────────────────────────────────────────
const TokenIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 text-cyan-400">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v12M8 10h8M8 14h8" />
    </svg>
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
            boxShadow: '0 6px 16px rgba(0,0,0,0.45), inset 0 -3px 6px rgba(0,0,0,0.35), inset 0 3px 6px rgba(255,255,255,0.25)'
        }}
    />
);

/** Faceted relic gem for collectible items (they carry no previewIcon) */
const ItemRelic = ({ px, tint }: { px: number; tint: string }) => (
    <div className="relative flex items-center justify-center" style={{ width: px, height: px }}>
        <div className={`absolute inset-[8%] rotate-45 rounded-[22%] ${tint} border border-white/40`} />
        <div className="absolute inset-[8%] rotate-45 rounded-[22%] bg-gradient-to-br from-white/50 via-transparent to-black/50" />
        <div className="absolute left-[1%] top-1/2 w-[98%] h-px bg-white/25 -rotate-45" />
        <div className="absolute left-[30%] top-[20%] w-[13%] h-[13%] rounded-full bg-white/90 blur-[1px]" />
    </div>
);
/** Micro-board swatch: 5x5 Ludo motif (path ring + home courts) — reads as a theme, not an icon */
const TEAM_DOTS = ['#ef4444', '#22c55e', '#eab308', '#3b82f6'];
const ThemeSwatch = ({ light = false, size = 52 }: { light?: boolean; size?: number }) => {
    const base = light ? '#dcd9ea' : '#161b28';
    const neutral = light ? '#c3c0d4' : '#2a3247';
    const corners = new Set([0, 4, 20, 24]);
    const ringOrder = [0, 1, 2, 3, 4, 9, 14, 19, 24, 23, 22, 21, 20, 15, 10, 5];
    const home: Record<number, string> = { 7: TEAM_DOTS[0], 11: TEAM_DOTS[1], 13: TEAM_DOTS[2], 17: TEAM_DOTS[3], 12: '#ffffff' };
    const cells: string[] = [];
    for (let i = 0; i < 25; i++) {
        if (home[i]) cells.push(home[i]);
        else if (corners.has(i)) cells.push(neutral);
        else if (ringOrder.includes(i)) cells.push(TEAM_DOTS[ringOrder.indexOf(i) % 4]);
        else cells.push(base);
    }
    return (
        <div className="relative rounded-xl overflow-hidden border border-white/25 shadow-lg" style={{ width: size, height: size, background: light ? '#e8e6f0' : '#0a0b14' }}>
            <div className="grid grid-cols-5 w-full h-full" style={{ gap: 1.5, padding: 5 }}>
                {cells.map((c, i) => (
                    <div key={i} className="rounded-[2px]" style={{ background: c }} />
                ))}
            </div>
            <div className="absolute inset-0 bg-gradient-to-br from-white/30 via-transparent to-black/30 pointer-events-none" />
        </div>
    );
};

// ─── Category meta (icons + labels) ─────────────────────────────────────────
const CheckIcon = ({ className = 'w-3 h-3' }: { className?: string }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" className={className}><polyline points="20 6 9 17 4 12"></polyline></svg>
);

const TAB_META: { id: MarketTab; label: string; icon: React.ReactNode }[] = [
    {
        id: 'themes', label: 'Themes',
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
    },
    {
        id: 'dices', label: 'Dices',
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><rect x="3" y="3" width="18" height="18" rx="4" /><circle cx="8.5" cy="8.5" r="1.4" fill="currentColor" stroke="none" /><circle cx="15.5" cy="15.5" r="1.4" fill="currentColor" stroke="none" /><circle cx="15.5" cy="8.5" r="1.4" fill="currentColor" stroke="none" /><circle cx="8.5" cy="15.5" r="1.4" fill="currentColor" stroke="none" /></svg>
    },
    {
        id: 'tokens', label: 'Tokens',
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></svg>
    },
    {
        id: 'items', label: 'Items',
        icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" className="w-4 h-4"><path d="M12 2l8 4.5v9L12 20l-8-4.5v-9L12 2z" /><path d="M12 11L4 6.5M12 11l8-4.5M12 11v9" /></svg>
    },
];

const RARITY_RANK: Record<Rarity, number> = { common: 1, rare: 2, legendary: 3 };
const RARITY_BEAM: Record<Rarity, string> = {
    common: 'bg-white/25',
    rare: 'bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.9)]',
    legendary: 'bg-fuchsia-400 shadow-[0_0_12px_rgba(232,121,249,0.9)]',
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
    common: 'rgba(255,255,255,0.10)',
    rare: 'rgba(34,211,238,0.28)',
    legendary: 'rgba(232,121,249,0.32)',
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
            id: 'theme-retro', type: 'themes', kind: 'theme', equipValue: 'retro',
            name: 'Retro Night',
            description: 'Deep space terminal aesthetic for focused gaming.',
            lore: 'Forged in the heart of a dying star, Retro Night brings the calm of the void to your board.',
            price: 0, owned: true, rarity: 'common', collection: 'Foundations', creator: 'LudoCorp',
            collectionStats: { floor: 0, volume: 100000, owners: 50000 },
            stats: [{ label: 'Mode', value: 'Dark' }, { label: 'Applies', value: 'Instant' }],
            traits: [{ trait_type: 'Style', value: 'Terminal', rarity_percent: 100 }],
            activity: [{ event: 'Created', from: 'System', to: 'Player', date: 'Genesis' }],
            chainInfo: { address: '0x000...000', standard: 'SBT', network: 'Base' },
            previewColor: 'bg-[#0a0b14]'
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
            chainInfo: { address: '0x111...222', standard: 'ERC-1155', network: 'Base' },
            previewColor: 'bg-[#e8e6f0]'
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
            chainInfo: { address: '0x000...000', standard: 'SBT', network: 'Base' },
            previewColor: 'bg-white/10', previewIcon: <DicePreview face="#ffffff" pip="#0F172A" />
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
            chainInfo: { address: '0x333...444', standard: 'ERC-1155', network: 'Base' },
            previewColor: 'bg-[#0b1220]', previewIcon: <DicePreview face="#0b1220" pip="#22d3ee" />
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
            chainInfo: { address: '0x555...666', standard: 'ERC-721', network: 'Base' },
            previewColor: 'bg-[#451a03]', previewIcon: <DicePreview face="#451a03" pip="#fcd34a" />
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
            chainInfo: { address: '0x000...000', standard: 'SBT', network: 'Base' },
            previewColor: 'bg-white/5', previewIcon: <img src="/tokens/king.png" alt="Chess" style={{ width: 44, height: 44, objectFit: 'contain' }} />
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
            chainInfo: { address: '0x777...888', standard: 'ERC-1155', network: 'Base' },
            previewColor: 'bg-white/5', previewIcon: <OrbPreview size={44} />
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
                { trait_type: 'Transparency', value: '98%', rarity_percent: 15 }
            ],
            activity: [
                { event: 'Sale', from: '0x441...111', to: '0x222...333', price: 175, date: '6h ago' },
                { event: 'Created', from: 'System', to: '0x441...111', date: '1w ago' }
            ],
            chainInfo: { address: '0x123...456', standard: 'ERC-1155', network: 'Base' },
            previewColor: 'bg-cyan-500/30'
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
                { trait_type: 'Temperature', value: 'Extreme', rarity_percent: 10 }
            ],
            activity: [
                { event: 'Transfer', from: '0x888...999', to: '0x222...333', date: '12h ago' },
                { event: 'Sale', from: '0x555...666', to: '0x888...999', price: 290, date: '1d ago' }
            ],
            chainInfo: { address: '0x987...654', standard: 'ERC-1155', network: 'Base' },
            previewColor: 'bg-orange-600'
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
                { trait_type: 'Reflection', value: '0%', rarity_percent: 1 }
            ],
            activity: [
                { event: 'Sale', from: '0xaaa...bbb', to: '0xccc...ddd', price: 1950, date: '3d ago' },
                { event: 'Created', from: 'System', to: '0xaaa...bbb', date: '1mo ago' }
            ],
            chainInfo: { address: '0xabc...def', standard: 'ERC-1155', network: 'Base' },
            previewColor: 'bg-black'
        },
        { id: 's4', type: 'items', kind: 'item', name: 'Neon-X', description: 'Electric skin.', lore: 'Pulsing neon.', price: 100, owned: false, rarity: 'common', collection: 'Core', creator: 'G', collectionStats: { floor: 80, volume: 2000, owners: 4100 }, stats: [], traits: [], activity: [], chainInfo: { address: '0x1', standard: 'ERC', network: 'B' }, previewColor: 'bg-cyan-600' },
        { id: 's5', type: 'items', kind: 'item', name: 'Cyber-V', description: 'Matrix skin.', lore: 'The digital frontier.', price: 240, owned: false, rarity: 'rare', collection: 'Core', creator: 'G', collectionStats: { floor: 200, volume: 1800, owners: 1900 }, stats: [], traits: [], activity: [], chainInfo: { address: '0x1', standard: 'ERC', network: 'B' }, previewColor: 'bg-cyan-500' },
        { id: 's6', type: 'items', kind: 'item', name: 'Steel-Z', description: 'Metal skin.', lore: 'Cold steel.', price: 60, owned: false, rarity: 'common', collection: 'Core', creator: 'G', collectionStats: { floor: 45, volume: 900, owners: 5200 }, stats: [], traits: [], activity: [], chainInfo: { address: '0x1', standard: 'ERC', network: 'B' }, previewColor: 'bg-gray-500' },
    ]);

    // ─── Mode + navigation state ───
    const [mode, setMode] = useState<Mode>('market');
    const [activeTab, setActiveTab] = useState<MarketTab>('themes');
    const [selectedItem, setSelectedItem] = useState<MarketItem | null>(null);
    const [confirmItem, setConfirmItem] = useState<MarketItem | null>(null);
    const [isSelling, setIsSelling] = useState(false);
    const [sellPrice, setSellPrice] = useState('');
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

    // ─── Real inventory + coins ───
    const { profile, address } = useCurrentUser();
    // Guests may browse + showcase, but buying hits the wall.
    const { guard } = useGuestWall();
    const { preferences, updatePreference } = usePreferences();
    const wallet = address?.toLowerCase() ?? null;
    const balance = profile?.coins || 0;

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
        setConfirmItem(null);
    };

    // ─── Real purchase: deduct coins in Supabase, persist ownership locally ───
    // Shared core so grid quick-buy and the inspect sheet use one flow.
    const buyItem = async (item: MarketItem) => {
        if (!wallet) return;
        if (!guard('market-buy')) return;
        if (balance < item.price) return;
        setIsProcessing(true);
        setTransactionResult(null);

        try {
            const { error } = await supabase
                .from('players')
                .update({ coins: balance - item.price })
                .eq('wallet_address', wallet);
            if (error) throw error;

            const next = addOwned(wallet, item.id);
            setOwnedIds(next);

            const newActivity: MarketActivity = {
                event: 'Sale', from: 'Market', to: 'Player', price: item.price, date: 'Just now'
            };
            setMarketData(prev => prev.map(m =>
                m.id === item.id
                    ? { ...m, owned: true, activity: [newActivity, ...m.activity] }
                    : m
            ));

            setIsProcessing(false);
            setSuccessNote(`${item.name} added to your vault.`);
            setTransactionResult('success');
        } catch (err) {
            console.error('❌ [Market] Buy failed:', err);
            setIsProcessing(false);
            setTransactionResult('error');
        }
    };

    const handleBuy = async () => {
        if (selectedItem) await buyItem(selectedItem);
    };

    // ─── Complete-the-set: buy every missing piece of the active tab at once ───
    const handleCompleteSet = async (missing: MarketItem[], total: number) => {
        if (!wallet || missing.length === 0 || balance < total) return;
        setIsProcessing(true);
        setTransactionResult(null);
        try {
            const { error } = await supabase
                .from('players')
                .update({ coins: balance - total })
                .eq('wallet_address', wallet);
            if (error) throw error;

            let next = ownedIds;
            const now = 'Just now';
            const boughtIds = new Set(missing.map(m => m.id));
            for (const m of missing) next = addOwned(wallet, m.id);
            setOwnedIds(next);
            setMarketData(prev => prev.map(item =>
                boughtIds.has(item.id)
                    ? { ...item, owned: true, activity: [{ event: 'Sale', from: 'Market', to: 'Player', price: item.price, date: now }, ...item.activity] }
                    : item
            ));
            setIsProcessing(false);
            setSuccessNote(`${missing.length} piece${missing.length > 1 ? 's' : ''} added — set complete.`);
            setTransactionResult('success');
        } catch (err) {
            console.error('❌ [Market] Complete-set failed:', err);
            setIsProcessing(false);
            setTransactionResult('error');
        }
    };

    // ─── Listing ───
    const handleConfirmListing = async () => {
        if (!selectedItem || !sellPrice) return;
        setIsProcessing(true);
        setTransactionResult(null);

        await new Promise(resolve => setTimeout(resolve, 1500));

        const priceNum = parseFloat(sellPrice);
        setMarketData(prev => prev.map(item => {
            if (item.id === selectedItem.id) {
                const newActivity: MarketActivity = {
                    event: 'List', from: 'Player', to: 'Market', price: priceNum,
                    duration: listingDuration === '7d' ? '7 Days' : listingDuration === '30d' ? '30 Days' : 'Indefinite',
                    date: 'Just now'
                };
                return { ...item, price: priceNum, activity: [newActivity, ...item.activity] };
            }
            return item;
        }));

        setIsProcessing(false);
        setSuccessNote(`${selectedItem.name} listed for ${priceNum.toLocaleString()} coins.`);
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
    };

    // ─── Derived: counts, filtering, sorting, set progress ───
    const counts = useMemo(() => {
        const c = {} as Record<MarketTab, { total: number; owned: number }>;
        for (const t of TAB_META) {
            const items = marketData.filter(i => i.type === t.id);
            c[t.id] = { total: items.length, owned: items.filter(i => isOwnedId(i.id)).length };
        }
        return c;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [marketData, ownedIds]);

    const totalOwned = TAB_META.reduce((n, t) => n + counts[t.id].owned, 0);

    const matchesSearch = (item: MarketItem) => {
        const q = search.trim().toLowerCase();
        if (!q) return true;
        return (
            item.name.toLowerCase().includes(q) ||
            item.collection.toLowerCase().includes(q) ||
            item.traits.some(t => t.value.toLowerCase().includes(q) || t.trait_type.toLowerCase().includes(q))
        );
    };

    const visibleItems = useMemo(() => {
        let items = marketData.filter(i => i.type === activeTab);
        if (mode === 'loadout') items = items.filter(i => isOwnedId(i.id));
        else if (statusFilter === 'sale') items = items.filter(i => !isOwnedId(i.id));
        else if (statusFilter === 'owned') items = items.filter(i => isOwnedId(i.id));
        if (rarityFilter !== 'all') items = items.filter(i => i.rarity === rarityFilter);
        items = items.filter(matchesSearch);
        const sorted = [...items];
        if (sort === 'price-asc') sorted.sort((a, b) => a.price - b.price);
        else if (sort === 'price-desc') sorted.sort((a, b) => b.price - a.price);
        else if (sort === 'rarity') sorted.sort((a, b) => RARITY_RANK[b.rarity] - RARITY_RANK[a.rarity]);
        return sorted;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [marketData, ownedIds, activeTab, mode, statusFilter, rarityFilter, search, sort]);

    const tabItems = useMemo(() => marketData.filter(i => i.type === activeTab), [marketData, activeTab]);
    const missing = useMemo(() => tabItems.filter(i => !isOwnedId(i.id)), [tabItems, ownedIds]);
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
            return <img src="/tokens/king.png" alt={item.name} style={{ width: px, height: px, objectFit: 'contain' }} />;
        }
        if (item.type === 'themes') return <ThemeSwatch light={item.equipValue === 'light'} size={px} />;
        if (item.kind === 'item') return <ItemRelic px={px} tint={item.previewColor} />;
        return item.previewIcon ?? null;
    };

    /** Rarity halo + pedestal shadow shared by cards and hero */
    const previewStage = (haloPx: string, rarity: Rarity) => (
        <>
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full blur-2xl pointer-events-none" style={{ width: haloPx, height: haloPx, background: RARITY_HALO[rarity] }} />
            <div className="absolute bottom-[16%] left-1/2 -translate-x-1/2 w-[58%] h-[10px] rounded-full bg-black/60 blur-[6px] pointer-events-none" />
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
        setIsSelling(true);
    };

    return (
        <>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <div className="fixed top-[64px] bottom-[80px] left-0 right-0 z-40 bg-transparent" />

                    {/* Panel */}
                    <div className="fixed inset-0 z-[110] flex justify-center pointer-events-none">
                        <div className="w-full max-w-[500px] relative h-full">
                            <div
                                ref={panelRef}
                                className="ludo-market-scope pointer-events-auto absolute top-[64px] bottom-[80px] left-[8px] right-[8px] border border-white/10 rounded-[32px] flex flex-col shadow-2xl overflow-hidden"
                                style={{ background: 'var(--panel-bg-image, var(--ludo-bg-cosmic))', backgroundColor: 'var(--panel-bg, rgba(13,13,13,0.92))', backdropFilter: 'blur(32px)' }}
                            >
                                {/* Cosmic orbs */}
                                <div className="absolute top-[-20%] left-[-20%] w-full h-full cosmic-orb cosmic-orb-1 opacity-20 scale-150 pointer-events-none" />
                                <div className="absolute bottom-[-20%] right-[-20%] w-full h-full cosmic-orb cosmic-orb-2 opacity-15 scale-150 pointer-events-none" />

                                {/* Drag Handle */}
                                <div className="w-full flex justify-center pt-2 pb-1 relative z-10">
                                    <div className="w-12 h-1.5 bg-white/20 rounded-full" />
                                </div>

                                {/* ─── Transaction overlays ─── */}
                                {isProcessing && (
                                    <div className="absolute inset-0 z-[100] flex flex-col items-center justify-center p-8 text-center" style={{ background: 'var(--ludo-bg-cosmic)', backgroundColor: '#1c1c1c' }}>
                                        <div className="absolute top-[-20%] left-[-20%] w-full h-full cosmic-orb cosmic-orb-1 opacity-20 scale-150 pointer-events-none" />
                                        <div className="absolute bottom-[-20%] right-[-20%] w-full h-full cosmic-orb cosmic-orb-2 opacity-15 scale-150 pointer-events-none" />
                                        <div className="relative mb-6">
                                            <div className="w-20 h-20 bg-cyan-600 rounded-full flex items-center justify-center animate-pulse">
                                                <div className="w-12 h-12 bg-white rounded-full" />
                                            </div>
                                            <div className="absolute inset-0 border-4 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin" />
                                        </div>
                                        <h3 className="text-xl font-black text-white mb-2">Updating your vault</h3>
                                        <p className="text-sm text-white/40 max-w-[220px]">Writing to your inventory on Base…</p>
                                    </div>
                                )}

                                {transactionResult === 'success' && (
                                    <div className="absolute inset-0 z-[100] flex flex-col items-center justify-center p-8 text-center" style={{ background: 'var(--ludo-bg-cosmic)', backgroundColor: '#1c1c1c' }}>
                                        <div className="absolute top-[-20%] left-[-20%] w-full h-full cosmic-orb cosmic-orb-1 opacity-20 scale-150 pointer-events-none" />
                                        <div className="absolute bottom-[-20%] right-[-20%] w-full h-full cosmic-orb cosmic-orb-2 opacity-15 scale-150 pointer-events-none" />
                                        <div className="w-24 h-24 bg-green-500/10 rounded-full flex items-center justify-center mb-6 shadow-[0_0_50px_rgba(34,197,94,0.2)]">
                                            <CheckIcon className="w-12 h-12 text-green-500" />
                                        </div>
                                        <h3 className="text-3xl font-black text-white mb-2 uppercase tracking-tight">Success!</h3>
                                        <p className="text-white/60 mb-8 max-w-[250px]">{successNote || 'Done.'}</p>
                                        <div className="w-full space-y-3">
                                            <button onClick={handleCloseDetail} className="w-full py-4 bg-white text-black rounded-2xl font-black text-base hover:bg-white/90 active:scale-95 transition-all shadow-xl">
                                                CONTINUE
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* ─── Header ─── */}
                                <div className="px-5 pb-3 border-b border-white/10 relative z-10">
                                    <div className="flex items-center justify-between mb-2 mt-1">
                                        <div className="flex flex-col">
                                            <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                                <div className="w-7 h-7 rounded-xl bg-cyan-500/15 border border-cyan-400/40 flex items-center justify-center shadow-[0_0_16px_rgba(34,211,238,0.25)]">
                                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-cyan-300">
                                                        <path d="M4 9l1.2-4.2A1 1 0 0 1 6.2 4h11.6a1 1 0 0 1 1 .8L20 9" />
                                                        <path d="M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9" />
                                                        <path d="M4 9h16" />
                                                        <path d="M9.5 20v-6h5v6" />
                                                    </svg>
                                                </div>
                                                Marketplace
                                            </h2>
                                            <div className="flex items-center gap-2 mt-1 px-0.5">
                                                <span className="flex items-center gap-1">
                                                    <TokenIcon />
                                                    <span className="text-[11px] font-black text-cyan-300 tracking-wide">BASE NETWORK</span>
                                                </span>
                                                <span className="w-0.5 h-0.5 rounded-full bg-white/25" />
                                                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/40 border border-white/10">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.8)]" />
                                                    <span className="text-[11px] font-black text-white tabular-nums">{balance.toLocaleString()}</span>
                                                </span>
                                            </div>
                                        </div>
                                        <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-all ring-1 ring-white/10 shadow-sm" aria-label="Close marketplace">
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                        </button>
                                    </div>

                                    {/* Mode switcher: STORE vs LOADOUT */}
                                    <div className="grid grid-cols-2 gap-1 p-1 rounded-2xl bg-black/50 border border-white/10">
                                        {(['market', 'loadout'] as Mode[]).map(m => {
                                            const active = mode === m;
                                            const count = m === 'market'
                                                ? marketData.length
                                                : totalOwned;
                                            return (
                                                <button
                                                    key={m}
                                                    onClick={() => switchMode(m)}
                                                    className={`flex items-center justify-center gap-1.5 py-1.5 rounded-xl font-black text-[10px] uppercase tracking-[0.2em] transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${active ? 'bg-cyan-500/20 text-white shadow-[inset_0_0_0_1px_rgba(34,211,238,0.5)]' : 'text-white/35 hover:text-white/70'}`}
                                                >
                                                    {m === 'market' ? 'Store' : 'Loadout'}
                                                    <span className={`px-1.5 py-0.5 rounded-md text-[9px] font-mono ${active ? 'bg-cyan-400/20 text-cyan-200' : 'bg-white/5 text-white/30'}`}>
                                                        {count}
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* ─── Category rail: separated browse zone with real air ─── */}
                                {!selectedItem && (
                                    <div className="px-5 pt-3 relative z-10">
                                        <div
                                            ref={railRef}
                                            className="flex gap-2 overflow-x-auto no-scrollbar pb-0.5 -mx-1 px-1 [mask-image:linear-gradient(to_right,transparent,black_20px,black_calc(100%-20px),transparent)]"
                                        >
                                            {TAB_META.map(t => {
                                                const active = activeTab === t.id;
                                                const n = mode === 'loadout' ? counts[t.id].owned : counts[t.id].total;
                                                return (
                                                    <button
                                                        key={t.id}
                                                        ref={active ? activeChipRef : undefined}
                                                        onClick={() => setActiveTab(t.id)}
                                                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[11px] font-black whitespace-nowrap transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 ${active ? 'border-cyan-400/70 bg-cyan-500/15 text-white shadow-[0_0_16px_rgba(34,211,238,0.25)]' : 'border-white/10 bg-black/30 text-white/40 hover:text-white/75 hover:border-white/25'}`}
                                                    >
                                                        <span className={active ? 'text-cyan-300' : ''}>{t.icon}</span>
                                                        {t.label}
                                                        <span className={`px-1.5 rounded-md text-[10px] font-mono ${active ? 'bg-cyan-400/20 text-cyan-100' : 'bg-white/5 text-white/30'}`}>{n}</span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}

                                {/* ─── Toolbar: compact row, icon is a static flex child ─── */}
                                {!selectedItem && (
                                    <div className="px-5 pt-3 relative z-10">
                                        <div className="flex items-stretch gap-1.5">
                                            {/* Search: icon is a static flex child — can never overlap text */}
                                            <div className="flex w-[118px] items-center gap-1.5 bg-black/40 border border-white/10 rounded-lg pl-2 pr-1 h-9 focus-within:border-cyan-500/60 transition-colors overflow-hidden">
                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="w-3.5 h-3.5 shrink-0 text-white/35">
                                                    <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.5" y2="16.5" />
                                                </svg>
                                                <input
                                                    value={search}
                                                    onChange={e => setSearch(e.target.value)}
                                                    placeholder="Search"
                                                    className="flex-1 min-w-0 bg-transparent border-0 p-0 text-[11px] font-bold text-white placeholder:text-white/25 focus:outline-none focus:ring-0"
                                                />
                                                {search && (
                                                    <button onClick={() => setSearch('')} className="shrink-0 w-5 h-5 flex items-center justify-center rounded-full bg-white/10 text-white/60 hover:text-white" aria-label="Clear search">
                                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="w-2.5 h-2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                                    </button>
                                                )}
                                            </div>
                                            <div className="relative flex-1 min-w-0">
                                                <select
                                                    value={sort}
                                                    onChange={e => setSort(e.target.value as SortKey)}
                                                    className="appearance-none w-full h-9 bg-black/40 border border-white/10 rounded-lg pl-2 pr-6 text-[11px] font-bold text-white/80 truncate focus:outline-none focus:border-cyan-500/60 transition-colors"
                                                    aria-label="Sort items"
                                                >
                                                    {(Object.keys(SORT_LABELS) as SortKey[]).map(k => (
                                                        <option key={k} value={k} className="bg-zinc-900">{SORT_LABELS[k]}</option>
                                                    ))}
                                                </select>
                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3 h-3 absolute right-1.5 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none"><polyline points="6 9 12 15 18 9" /></svg>
                                            </div>
                                            <button
                                                onClick={() => setFilterOpen(true)}
                                                className={`relative w-9 h-9 shrink-0 flex items-center justify-center rounded-lg border transition-all ${activeFilterCount > 0 ? 'border-cyan-400/60 bg-cyan-500/15 text-cyan-200' : 'border-white/10 bg-black/40 text-white/50 hover:text-white'}`}
                                                aria-label="Open filters"
                                            >
                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="w-3.5 h-3.5"><line x1="4" y1="6" x2="20" y2="6" /><line x1="7" y1="12" x2="17" y2="12" /><line x1="10" y1="18" x2="14" y2="18" /></svg>
                                                {activeFilterCount > 0 && (
                                                    <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-cyan-400 text-black text-[9px] font-black flex items-center justify-center">{activeFilterCount}</span>
                                                )}
                                            </button>
                                            <div className="flex shrink-0 items-center bg-black/40 border border-white/10 rounded-lg p-0.5 h-9">
                                                {(['comfort', 'compact'] as const).map(d => (
                                                    <button
                                                        key={d}
                                                        onClick={() => setDensity(d)}
                                                        className={`w-7 h-full flex items-center justify-center rounded-md transition-all ${density === d ? 'bg-white/15 text-white' : 'text-white/30 hover:text-white/60'}`}
                                                        aria-label={d === 'comfort' ? 'Comfortable grid' : 'Compact grid'}
                                                    >
                                                        {d === 'comfort' ? (
                                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
                                                        ) : (
                                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5"><rect x="3" y="3" width="5" height="5" rx="1" /><rect x="10" y="3" width="5" height="5" rx="1" /><rect x="17" y="3" width="5" height="5" rx="1" /><rect x="3" y="10" width="5" height="5" rx="1" /><rect x="10" y="10" width="5" height="5" rx="1" /><rect x="17" y="10" width="5" height="5" rx="1" /><rect x="3" y="17" width="5" height="5" rx="1" /><rect x="10" y="17" width="5" height="5" rx="1" /><rect x="17" y="17" width="5" height="5" rx="1" /></svg>
                                                        )}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                        {/* section label with room to breathe */}
                                        <div className="mt-2 mb-0.5 flex items-center gap-2.5">
                                            <span className="px-2 py-0.5 rounded-md bg-white/[0.07] border border-white/10 text-[10px] font-black tracking-[0.18em] text-white/60 font-mono">
                                                {visibleItems.length} {visibleItems.length === 1 ? 'PIECE' : 'PIECES'}
                                            </span>
                                            <div className="flex-1 h-px bg-gradient-to-r from-white/15 to-transparent" />
                                            {mode === 'loadout' && <span className="text-[10px] font-bold uppercase tracking-widest text-white/30">in your vault</span>}
                                        </div>
                                    </div>
                                )}

                                {/* ─── Grid ─── */}
                                <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar pt-2 px-5 mb-2 relative z-10">
                                    {visibleItems.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center text-center py-16 px-6">
                                            <div className="w-16 h-16 rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center mb-4 text-white/30">
                                                {TAB_META.find(t => t.id === activeTab)?.icon}
                                            </div>
                                            <h3 className="text-white font-black text-sm mb-1">
                                                {mode === 'loadout' ? `No ${activeTab} in your vault yet` : 'Nothing matches those filters'}
                                            </h3>
                                            <p className="text-white/40 text-xs mb-5 max-w-[220px]">
                                                {mode === 'loadout'
                                                    ? 'Grab gear from the store — anything you buy lands here, ready to equip.'
                                                    : 'Try a different search or clear the active filters.'}
                                            </p>
                                            {mode === 'loadout' ? (
                                                <button onClick={() => switchMode('market')} className="px-5 py-2.5 rounded-xl bg-cyan-500/20 border border-cyan-400/50 text-cyan-100 text-xs font-black uppercase tracking-widest hover:bg-cyan-500/30 transition-all">
                                                    Browse store
                                                </button>
                                            ) : (
                                                <button onClick={() => { setSearch(''); setStatusFilter('all'); setRarityFilter('all'); }} className="px-5 py-2.5 rounded-xl bg-white/10 border border-white/15 text-white text-xs font-black uppercase tracking-widest hover:bg-white/15 transition-all">
                                                    Clear filters
                                                </button>
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
                                                    ? (owned ? 'SELL' : `BUY · ${formatCompact(item.price)}`)
                                                    : (item.equipValue ? (equipped ? null : 'ACTIVATE') : (showcased ? null : 'SHOWCASE'));
                                                const runQuick = (e: React.MouseEvent) => {
                                                    e.stopPropagation();
                                                    if (!isLoadout) {
                                                        if (!owned) {
                                                            // Broke? Fall through to inspect where the shortfall is explained.
                                                            if (wallet && balance >= item.price) buyItem(item);
                                                            else setSelectedItem(item);
                                                        }
                                                        else openSell(item);
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
                                                        className={`group relative rounded-2xl bg-white/[0.04] border border-white/10 overflow-hidden cursor-pointer transition-all hover:border-white/25 hover:bg-white/[0.07] active:scale-[0.98] ${marked ? 'ring-1 ring-green-400/60 shadow-[0_0_20px_rgba(74,222,128,0.15)]' : ''}`}
                                                    >
                                                        {/* rarity beam */}
                                                        <div className={`absolute left-0 top-3 bottom-3 w-[3px] rounded-full z-20 ${RARITY_BEAM[item.rarity]}`} />
                                                        {/* preview stage: halo + pedestal + oversized art */}
                                                        <div className={`relative ${item.previewColor} ${density === 'comfort' ? 'aspect-[5/4]' : 'aspect-[5/4]'} flex items-center justify-center overflow-hidden`}>
                                                            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(255,255,255,0.12),transparent_65%)] pointer-events-none" />
                                                            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/55 pointer-events-none" />
                                                            {item.rarity === 'legendary' && <div className="absolute inset-0 bg-fuchsia-500/10 animate-pulse pointer-events-none" />}
                                                            {previewStage(density === 'comfort' ? '120px' : '88px', item.rarity)}
                                                            {/* rarity sigil floats on the art — frees the full row for the name */}
                                                            <div className={`absolute top-2 left-2.5 z-20 rounded-md flex items-center justify-center font-black backdrop-blur-sm border ${density === 'comfort' ? 'w-5 h-5 text-[10px]' : 'w-4 h-4 text-[8px]'} ${item.rarity === 'legendary' ? 'bg-fuchsia-500/30 border-fuchsia-300/50 text-fuchsia-100' : item.rarity === 'rare' ? 'bg-cyan-500/30 border-cyan-300/50 text-cyan-100' : 'bg-black/40 border-white/20 text-white/60'}`}>
                                                                {item.rarity === 'common' ? 'C' : item.rarity === 'rare' ? 'R' : 'L'}
                                                            </div>
                                                            <div className="relative z-10 transition-transform duration-300 group-hover:scale-110 group-hover:-translate-y-0.5 drop-shadow-[0_10px_16px_rgba(0,0,0,0.5)]">
                                                                {itemPreview(item, density === 'comfort' ? 76 : 60)}
                                                            </div>
                                                            {/* store: tiny owned badge (no equipped tag, no tick) */}
                                                            {!isLoadout && owned && (
                                                                <div className="absolute top-2 right-2 z-20 px-1.5 py-0.5 rounded-md bg-black/55 border border-white/15 backdrop-blur-sm text-[8px] font-black tracking-[0.14em] text-white/75">
                                                                    OWNED
                                                                </div>
                                                            )}
                                                            {/* loadout mark: active gear or showcased relic */}
                                                            {marked && (
                                                                <>
                                                                    <div className="absolute bottom-2 left-2 z-20 px-2 py-0.5 rounded-full bg-green-500/25 border border-green-400/60 text-green-200 text-[8px] font-black uppercase tracking-[0.16em] shadow-lg whitespace-nowrap backdrop-blur-sm">
                                                                        {equipped ? 'Active' : 'Showcasing'}
                                                                    </div>
                                                                    <div className="porcelain-holo-tick absolute top-2 right-2 w-5 h-5 rounded-full bg-green-500 flex items-center justify-center shadow-lg z-20">
                                                                        <CheckIcon className="w-3 h-3 text-white" />
                                                                    </div>
                                                                </>
                                                            )}
                                                        </div>
                                                        {/* body: title + price only */}
                                                        <div className={`${density === 'comfort' ? 'p-3' : 'p-2'}`}>
                                                            <h3 className={`font-black text-white ${density === 'comfort' ? 'text-[12.5px] leading-tight line-clamp-2 min-h-[2.1em]' : 'text-[11px] truncate'}`}>{item.name}</h3>
                                                            <div className="flex items-center gap-1 mt-1">
                                                                <span className="w-2.5 h-2.5 rounded-full bg-yellow-400 shadow-[0_0_6px_rgba(250,204,21,0.7)]" />
                                                                <span className={`font-black text-white font-mono ${density === 'comfort' ? 'text-[13px]' : 'text-[11px]'}`}>{item.price.toLocaleString()}</span>
                                                            </div>
                                                        </div>
                                                        {/* hover quick-action rail */}
                                                        {quickLabel && (
                                                            <div className="absolute inset-x-0 bottom-0 z-20 translate-y-[102%] group-hover:translate-y-0 group-focus-within:translate-y-0 transition-transform duration-200">
                                                                <button
                                                                    onClick={runQuick}
                                                                    className="w-full py-2 bg-black/70 backdrop-blur-md border-t border-white/15 text-[10px] font-black uppercase tracking-[0.16em] text-white hover:bg-cyan-500/30 hover:text-cyan-100 transition-colors"
                                                                >
                                                                    {quickLabel}
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>

                                {/* ─── Set-completion bar (store only) ─── */}
                                {mode === 'market' && !selectedItem && tabItems.length > 0 && (
                                    <div className="px-5 pb-3 relative z-10">
                                        {missing.length === 0 ? (
                                            <div className="flex items-center gap-3 rounded-2xl border border-green-400/30 bg-green-500/10 px-4 py-2.5">
                                                <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center shrink-0">
                                                    <CheckIcon className="w-4 h-4 text-green-300" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-xs font-black text-green-200 uppercase tracking-[0.14em]">Set complete</div>
                                                    <div className="text-[11px] font-bold text-green-200/60 truncate">Every {TAB_SINGULAR[activeTab]} piece is yours. Flex accordingly.</div>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-black/60 px-4 pt-2 pb-2 shadow-[0_-6px_24px_rgba(0,0,0,0.45)]">
                                                <div className="flex items-center gap-2 mb-2">
                                                    <span className="shrink-0 text-[10px] font-black uppercase tracking-[0.16em] text-white/55">
                                                        {TAB_META.find(t => t.id === activeTab)?.label} set
                                                    </span>
                                                    <span className="shrink-0 px-1.5 py-0.5 rounded-md bg-white/10 text-[10px] font-black font-mono text-white/80">
                                                        {tabItems.length - missing.length}/{tabItems.length}
                                                    </span>
                                                    <div className="flex-1 min-w-0 text-right">
                                                        {cheapestMissing && (
                                                            <span className="block truncate text-[10px] font-bold text-white/40">
                                                                next: <span className="text-white/70">{cheapestMissing.name}</span>
                                                                {' · '}<span className="text-yellow-300 font-mono">{formatCompact(cheapestMissing.price)}</span>
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    <div className="flex-1 min-w-0">
                                                        <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                                                            <div
                                                                className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-fuchsia-400 transition-all"
                                                                style={{ width: `${((tabItems.length - missing.length) / tabItems.length) * 100}%` }}
                                                            />
                                                        </div>
                                                        <div className="mt-1.5 text-[10px] font-bold text-white/35 truncate">
                                                            {missing.length} to go · {formatCompact(missingTotal)} total
                                                        </div>
                                                    </div>
                                                    <button
                                                        onClick={() => handleCompleteSet(missing, missingTotal)}
                                                        disabled={balance < missingTotal}
                                                        className={`shrink-0 min-w-[92px] px-3 py-1.5 rounded-xl transition-all active:scale-95 flex flex-col items-center leading-tight ${balance >= missingTotal ? 'bg-white text-black hover:bg-white/85 shadow-[0_4px_20px_rgba(255,255,255,0.25)]' : 'bg-white/5 text-white/30 border border-white/10 cursor-not-allowed'}`}
                                                    >
                                                        {balance >= missingTotal ? (
                                                            <>
                                                                <span className="text-[11px] font-black uppercase tracking-[0.12em]">Complete</span>
                                                                <span className="text-[10px] font-black font-mono opacity-70">{formatCompact(missingTotal)} coins</span>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <span className="text-[11px] font-black uppercase tracking-[0.12em]">Locked</span>
                                                                <span className="text-[10px] font-bold font-mono opacity-70">need {formatCompact(missingTotal - balance)}</span>
                                                            </>
                                                        )}
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* ─── Activation ritual (loadout tap on inactive gear / unshowcased relic) ─── */}
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
                                            <div className="absolute inset-0 bg-black/65 backdrop-blur-[2px]" onClick={() => setConfirmItem(null)} />
                                            <div className="relative rounded-t-[24px] border-t border-cyan-400/25 bg-[#151515] p-5 pb-7 shadow-[0_-20px_60px_rgba(34,211,238,0.15)]">
                                                <div className="w-10 h-1 rounded-full bg-white/20 mx-auto mb-4" />
                                                <div className="text-center text-[10px] font-black uppercase tracking-[0.24em] text-cyan-300 mb-4">
                                                    {verb} {slotLabel}
                                                </div>
                                                {/* swap preview: current → incoming */}
                                                <div className="flex items-center justify-center gap-4 mb-4">
                                                    <div className="flex flex-col items-center gap-1.5">
                                                        <div className={`w-14 h-14 rounded-2xl ${current?.previewColor ?? 'bg-white/5'} border border-white/10 flex items-center justify-center overflow-hidden opacity-60`}>
                                                            {current ? itemPreview(current, 34) : null}
                                                        </div>
                                                        <span className="text-[9px] font-bold text-white/35 max-w-[72px] truncate">{current?.name ?? 'Empty'}</span>
                                                    </div>
                                                    <div className="flex flex-col items-center gap-1 pb-4">
                                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-cyan-300"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
                                                        <span className="text-[8px] font-black uppercase tracking-widest text-white/30">replaces</span>
                                                    </div>
                                                    <div className="flex flex-col items-center gap-1.5">
                                                        <div className={`w-14 h-14 rounded-2xl ${confirmItem.previewColor} border border-cyan-400/60 flex items-center justify-center overflow-hidden shadow-[0_0_24px_rgba(34,211,238,0.3)]`}>
                                                            {itemPreview(confirmItem, 34)}
                                                        </div>
                                                        <span className="text-[9px] font-black text-white max-w-[72px] truncate">{confirmItem.name}</span>
                                                    </div>
                                                </div>
                                                <p className="text-center text-[11px] font-bold text-white/45 mb-4 px-4">
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
                                                    <button
                                                        onClick={() => setConfirmItem(null)}
                                                        className="flex-1 py-3.5 rounded-2xl bg-white/5 border border-white/10 text-white/60 text-xs font-black uppercase tracking-widest hover:bg-white/10 transition-all"
                                                    >
                                                        Keep current
                                                    </button>
                                                    <button
                                                        data-testid="confirm-activate"
                                                        onClick={confirmActivation}
                                                        className="flex-1 py-3.5 rounded-2xl bg-cyan-400 text-black text-xs font-black uppercase tracking-widest hover:bg-cyan-300 active:scale-[0.98] transition-all shadow-[0_8px_30px_rgba(34,211,238,0.35)]"
                                                    >
                                                        {verb === 'Activate' ? 'ACTIVATE' : 'SHOWCASE'}
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })()}

                                {/* ─── Filter sheet ─── */}
                                {filterOpen && (
                                    <div className="absolute inset-0 z-[125] flex flex-col justify-end">
                                        <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={() => setFilterOpen(false)} />
                                        <div className="relative rounded-t-[24px] border-t border-white/10 bg-[#161616] p-5 pb-8">
                                            <div className="w-10 h-1 rounded-full bg-white/20 mx-auto mb-4" />
                                            <div className="flex items-center justify-between mb-4">
                                                <h3 className="text-base font-black text-white uppercase tracking-wide">Filters</h3>
                                                <button onClick={() => { setStatusFilter('all'); setRarityFilter('all'); }} className="text-[11px] font-black uppercase tracking-widest text-cyan-300 hover:text-cyan-100">
                                                    Clear all
                                                </button>
                                            </div>
                                            {mode === 'market' && (
                                                <div className="mb-4">
                                                    <div className="text-[10px] font-black uppercase tracking-widest text-white/35 mb-2">Status</div>
                                                    <div className="flex gap-2">
                                                        {([['all', 'All'], ['sale', 'For sale'], ['owned', 'Owned by you']] as [StatusFilter, string][]).map(([v, label]) => (
                                                            <button
                                                                key={v}
                                                                onClick={() => setStatusFilter(v)}
                                                                className={`flex-1 py-2.5 rounded-xl border text-xs font-black transition-all ${statusFilter === v ? 'border-cyan-400/60 bg-cyan-500/15 text-white' : 'border-white/10 bg-white/[0.03] text-white/45 hover:text-white/75'}`}
                                                            >
                                                                {label}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                            <div className="mb-5">
                                                <div className="text-[10px] font-black uppercase tracking-widest text-white/35 mb-2">Rarity</div>
                                                <div className="flex gap-2">
                                                    {([['all', 'All'], ['common', 'Common'], ['rare', 'Rare'], ['legendary', 'Legendary']] as ['all' | Rarity, string][]).map(([v, label]) => (
                                                        <button
                                                            key={v}
                                                            onClick={() => setRarityFilter(v)}
                                                            className={`flex-1 py-2.5 rounded-xl border text-xs font-black transition-all ${rarityFilter === v ? 'border-cyan-400/60 bg-cyan-500/15 text-white' : 'border-white/10 bg-white/[0.03] text-white/45 hover:text-white/75'}`}
                                                        >
                                                            {label}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                            <button onClick={() => setFilterOpen(false)} className="w-full py-3.5 rounded-2xl bg-white text-black font-black text-sm uppercase tracking-wide hover:bg-white/90 active:scale-[0.98] transition-all">
                                                Show {visibleItems.length} {visibleItems.length === 1 ? 'piece' : 'pieces'}
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* ─── Inspect sheet ─── */}
                                {selectedItem && (() => {
                                    const owned = isOwnedId(selectedItem.id);
                                    const equipped = isEquipped(selectedItem);
                                    const showcased = showcasedId === selectedItem.id;
                                    const isLoadout = mode === 'loadout';
                                    const sale = lastSale(selectedItem);
                                    const canAfford = balance >= selectedItem.price;
                                    // Live "in match" context: what this piece does (or replaces) right now.
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
                                        <div className="absolute inset-0 z-[120] flex flex-col rounded-[24px] overflow-hidden shadow-2xl border border-white/10" style={{ background: 'var(--ludo-bg-cosmic)', backgroundColor: '#1c1c1c' }}>
                                            <div className="absolute top-[-20%] left-[-20%] w-full h-full cosmic-orb cosmic-orb-1 opacity-20 scale-150 pointer-events-none" />
                                            <div className="absolute bottom-[-20%] right-[-20%] w-full h-full cosmic-orb cosmic-orb-2 opacity-15 scale-150 pointer-events-none" />
                                            {/* header */}
                                            <div className="flex items-center justify-between py-4 px-5 border-b border-white/10 bg-white/5 backdrop-blur-xl z-20">
                                                <div className="flex items-center gap-3">
                                                    <button onClick={handleCloseDetail} className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 text-white/50 hover:text-white transition-all" aria-label="Back">
                                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
                                                    </button>
                                                    <h2 className="text-base font-black text-white tracking-tight">Inspect</h2>
                                                </div>
                                                <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${selectedItem.rarity === 'legendary' ? 'border-fuchsia-400/50 text-fuchsia-300 bg-fuchsia-500/10' : selectedItem.rarity === 'rare' ? 'border-cyan-400/50 text-cyan-300 bg-cyan-500/10' : 'border-white/15 text-white/50 bg-white/5'}`}>
                                                    {selectedItem.rarity}
                                                </span>
                                            </div>

                                            {/* scrollable */}
                                            <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-5 pb-40">
                                                {/* hero */}
                                                <div className={`relative mt-5 rounded-3xl ${selectedItem.previewColor} border border-white/10 overflow-hidden`}>
                                                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_28%,rgba(255,255,255,0.14),transparent_65%)] pointer-events-none" />
                                                    <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/60 pointer-events-none" />
                                                    {previewStage('190px', selectedItem.rarity)}
                                                    <div className="relative h-56 flex items-center justify-center">
                                                        {itemPreview(selectedItem, selectedItem.type === 'themes' ? 104 : 88)}
                                                    </div>
                                                    {isLoadout && (equipped || showcased) && (
                                                        <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-green-500/25 border border-green-400/60 text-green-200 text-[10px] font-black uppercase tracking-widest shadow-lg backdrop-blur-sm">
                                                            {equipped ? 'Active' : 'Showcasing'}
                                                        </div>
                                                    )}
                                                    {!isLoadout && owned && (
                                                        <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-black/55 border border-white/15 text-white/75 text-[10px] font-black uppercase tracking-widest shadow-lg backdrop-blur-sm">
                                                            Owned
                                                        </div>
                                                    )}
                                                </div>

                                                {/* title */}
                                                <div className="mt-4">
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className="text-[10px] text-white/40 font-bold uppercase tracking-wider">{selectedItem.collection}</span>
                                                        <span className="w-1 h-1 bg-white/20 rounded-full" />
                                                        <span className="text-[10px] text-cyan-400 font-bold">@{selectedItem.creator}</span>
                                                    </div>
                                                    <h1 className="text-2xl font-black text-white">{selectedItem.name}</h1>
                                                    <p className="text-white/45 text-[13px] leading-relaxed mt-1.5">{selectedItem.description}</p>
                                                </div>

                                                {/* in match — what this piece actually does */}
                                                <div className="mt-4 rounded-2xl border border-cyan-500/15 bg-cyan-500/[0.04] p-4">
                                                    <div className="flex items-center justify-between mb-2">
                                                        <h4 className="text-[10px] text-cyan-300 font-black uppercase tracking-widest">In match</h4>
                                                        <span className="flex items-center gap-1.5">
                                                            <span className={`w-1.5 h-1.5 rounded-full ${statusLive ? 'bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.9)]' : owned ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.9)]' : 'bg-white/25'}`} />
                                                            <span className="text-[9px] font-black uppercase tracking-widest text-white/45">
                                                                {statusLive ? 'Live' : owned ? 'In vault' : 'Not owned'}
                                                            </span>
                                                        </span>
                                                    </div>
                                                    <div className="flex flex-col gap-2">
                                                        {inMatch.map((row, i) => (
                                                            <div key={i} className="flex items-start justify-between gap-3">
                                                                <span className="text-[10px] font-bold text-white/35 uppercase tracking-wider shrink-0">{row.label}</span>
                                                                <span className={`text-[11px] font-bold text-right leading-snug ${row.live ? 'text-cyan-200' : 'text-white/75'}`}>{row.value}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>

                                                {/* price box */}
                                                <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-[10px] text-white/35 font-black uppercase tracking-widest">{owned ? 'You own this' : 'Price'}</span>
                                                        {sale !== undefined && <span className="text-[10px] font-bold text-white/35 font-mono">last sale {sale.toLocaleString()}</span>}
                                                    </div>
                                                    <div className="flex items-center gap-2 mt-1">
                                                        <span className="w-4 h-4 rounded-full bg-yellow-400 shadow-[0_0_10px_rgba(250,204,21,0.7)]" />
                                                        <span className="porcelain-hero text-3xl font-black text-white font-mono">{selectedItem.price.toLocaleString()}</span>
                                                        <span className="text-sm font-bold text-white/35">coins</span>
                                                    </div>
                                                    {!owned && !canAfford && (
                                                        <p className="mt-1.5 text-[11px] font-bold text-red-300/90">You need {(selectedItem.price - balance).toLocaleString()} more coins.</p>
                                                    )}
                                                    {transactionResult === 'error' && (
                                                        <p className="mt-1.5 text-[11px] font-bold text-red-300/90">Purchase failed — check your connection and try again.</p>
                                                    )}
                                                </div>

                                                {/* traits */}
                                                {selectedItem.traits.length > 0 && (
                                                    <div className="mt-5">
                                                        <h4 className="text-[10px] text-white/35 font-black uppercase tracking-widest mb-2">Properties</h4>
                                                        <div className="grid grid-cols-3 gap-2">
                                                            {selectedItem.traits.map((trait, i) => (
                                                                <div key={i} className="bg-white/5 border border-cyan-600/20 rounded-xl p-2.5 flex flex-col items-center text-center">
                                                                    <span className="text-[8px] text-cyan-400/60 font-black uppercase mb-0.5">{trait.trait_type}</span>
                                                                    <span className="text-[10px] text-white font-bold mb-1 truncate w-full">{trait.value}</span>
                                                                    <span className="text-[9px] text-cyan-400 font-mono">{trait.rarity_percent}%</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}

                                                {/* lore */}
                                                <div className="mt-4 rounded-2xl bg-cyan-500/5 border border-cyan-500/10 p-4">
                                                    <h4 className="text-[10px] text-cyan-400 font-black uppercase tracking-widest mb-1.5">Item Lore</h4>
                                                    <p className="text-xs text-white/60 italic leading-relaxed">{selectedItem.lore}</p>
                                                </div>

                                                {/* activity */}
                                                {selectedItem.activity.length > 0 && (
                                                    <div className="mt-5">
                                                        <h4 className="text-[10px] text-white/35 font-black uppercase tracking-widest mb-2">Activity</h4>
                                                        <div className="bg-white/5 border border-white/5 rounded-2xl overflow-hidden text-[10px]">
                                                            {selectedItem.activity.slice(0, 5).map((act, i) => (
                                                                <div key={i} className={`flex items-center justify-between px-4 py-3 ${i !== 0 ? 'border-t border-white/5' : ''}`}>
                                                                    <div className="flex items-center gap-2">
                                                                        <span className={`w-1.5 h-1.5 rounded-full ${act.event === 'Created' ? 'bg-green-400' : act.event === 'Sale' ? 'bg-cyan-400' : act.event === 'List' ? 'bg-orange-400' : 'bg-white/20'}`} />
                                                                        <span className="text-white font-bold">{act.event}</span>
                                                                    </div>
                                                                    <div className="flex items-center gap-2 font-mono text-white/50">
                                                                        {act.price !== undefined && <span className="text-white font-bold">{act.price.toLocaleString()} coins</span>}
                                                                        <span className="text-white/25">{act.date}</span>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            {/* footer: store = buy/sell only · loadout = activate/showcase only */}
                                            <div className="absolute bottom-0 inset-x-0 p-5 pb-7 bg-gradient-to-t from-black/70 via-black/40 to-transparent z-40">
                                                {!isLoadout ? (
                                                    owned ? (
                                                        <button onClick={() => setIsSelling(true)} className="w-full py-4 bg-white text-black rounded-2xl font-black text-base hover:bg-white/90 active:scale-95 transition-all shadow-xl">
                                                            SELL
                                                        </button>
                                                    ) : (
                                                        <button
                                                            onClick={handleBuy}
                                                            disabled={!canAfford || !wallet}
                                                            className={`w-full py-4 rounded-2xl font-black text-base transition-all active:scale-95 ${canAfford && wallet ? 'bg-white text-black hover:bg-white/90 shadow-[0_8px_30px_rgba(255,255,255,0.2)]' : 'bg-white/10 text-white/30 cursor-not-allowed'}`}
                                                        >
                                                            {!wallet ? 'CONNECT WALLET TO BUY' : `BUY · ${selectedItem.price.toLocaleString()} COINS`}
                                                        </button>
                                                    )
                                                ) : selectedItem.equipValue ? (
                                                    equipped ? (
                                                        <div className="w-full py-4 rounded-2xl bg-green-500/15 border border-green-400/40 text-green-300 font-black text-sm uppercase tracking-widest text-center">
                                                            Active in matches
                                                        </div>
                                                    ) : (
                                                        <button onClick={() => setConfirmItem(selectedItem)} className="w-full py-4 bg-cyan-400 text-black rounded-2xl font-black text-base hover:bg-cyan-300 active:scale-95 transition-all shadow-[0_8px_30px_rgba(34,211,238,0.35)]">
                                                            ACTIVATE
                                                        </button>
                                                    )
                                                ) : showcased ? (
                                                    <div className="w-full py-4 rounded-2xl bg-green-500/15 border border-green-400/40 text-green-300 font-black text-sm uppercase tracking-widest text-center">
                                                        Showcasing in vault
                                                    </div>
                                                ) : (
                                                    <button onClick={() => setConfirmItem(selectedItem)} className="w-full py-4 bg-cyan-400 text-black rounded-2xl font-black text-base hover:bg-cyan-300 active:scale-95 transition-all shadow-[0_8px_30px_rgba(34,211,238,0.35)]">
                                                        SHOWCASE
                                                    </button>
                                                )}
                                            </div>

                                            {/* sell overlay */}
                                            {isSelling && (
                                                <div className="absolute inset-0 z-[130] flex flex-col overflow-hidden rounded-[24px] border border-white/10" style={{ background: 'var(--ludo-bg-cosmic)', backgroundColor: '#1c1c1c' }}>
                                                    <div className="absolute top-[-20%] left-[-20%] w-full h-full cosmic-orb cosmic-orb-1 opacity-20 scale-150 pointer-events-none" />
                                                    <div className="absolute bottom-[-20%] right-[-20%] w-full h-full cosmic-orb cosmic-orb-2 opacity-15 scale-150 pointer-events-none" />
                                                    <div className="flex items-center justify-between py-4 px-5 border-b border-white/10 bg-white/5 backdrop-blur-xl z-20">
                                                        <div className="flex items-center gap-3">
                                                            <button onClick={() => setIsSelling(false)} className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 text-white/50 hover:text-white transition-all" aria-label="Back to inspect">
                                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
                                                            </button>
                                                            <h3 className="text-base font-black text-white tracking-tight">List for Sale</h3>
                                                        </div>
                                                    </div>
                                                    <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar relative z-10 px-5 pt-6 pb-32">
                                                        <div className="flex items-center gap-4 bg-white/5 p-4 rounded-3xl border border-white/10 mb-6">
                                                            <div className={`w-16 h-16 rounded-2xl ${selectedItem.previewColor} flex items-center justify-center shadow-lg border border-white/5 overflow-hidden`}>
                                                                {itemPreview(selectedItem, 36)}
                                                            </div>
                                                            <div>
                                                                <h4 className="text-sm font-black text-white">{selectedItem.name}</h4>
                                                                <p className="text-[10px] text-white/40 font-bold tracking-wider uppercase">{selectedItem.collection}</p>
                                                            </div>
                                                        </div>
                                                        <div className="mb-5">
                                                            <label className="text-[10px] text-white/30 font-black uppercase tracking-widest mb-2 block">Set price (coins)</label>
                                                            <div className="relative">
                                                                <input
                                                                    type="number"
                                                                    placeholder="0"
                                                                    value={sellPrice}
                                                                    onChange={e => setSellPrice(e.target.value)}
                                                                    className="w-full bg-white/5 border border-white/10 rounded-2xl p-5 text-3xl font-mono font-black text-white focus:outline-none focus:border-cyan-600/50 transition-all placeholder:text-white/10"
                                                                />
                                                                <div className="absolute right-5 top-1/2 -translate-y-1/2 text-sm font-black text-white/25 uppercase">coins</div>
                                                            </div>
                                                        </div>
                                                        <div className="mb-6">
                                                            <label className="text-[10px] text-white/30 font-black uppercase tracking-widest mb-2 block">Duration</label>
                                                            <div className="flex bg-white/5 p-1 rounded-2xl border border-white/10">
                                                                {(['7d', '30d', 'indefinite'] as const).map(d => (
                                                                    <button
                                                                        key={d}
                                                                        onClick={() => setListingDuration(d)}
                                                                        className={`flex-1 py-3 text-[10px] font-black uppercase tracking-wider rounded-xl transition-all ${listingDuration === d ? 'bg-cyan-600 text-white shadow-lg' : 'text-white/30 hover:text-white/60'}`}
                                                                    >
                                                                        {d === '7d' ? '7 Days' : d === '30d' ? '30 Days' : 'No expiry'}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>
                                                        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 mb-6">
                                                            <div className="flex justify-between text-[11px] font-medium mb-2">
                                                                <span className="text-white/40">Marketplace fee</span>
                                                                <span className="text-white font-mono">2.5%</span>
                                                            </div>
                                                            <div className="h-px bg-white/10 my-2" />
                                                            <div className="flex justify-between items-center">
                                                                <span className="text-xs font-black text-white uppercase tracking-wider">You receive</span>
                                                                <span className="text-2xl font-black font-mono text-green-400">
                                                                    {sellPrice && Number(sellPrice) > 0 ? (Number(sellPrice) * 0.975).toLocaleString(undefined, { maximumFractionDigits: 0 }) : '0'} <span className="text-[10px]">coins</span>
                                                                </span>
                                                            </div>
                                                        </div>
                                                        <button
                                                            onClick={handleConfirmListing}
                                                            disabled={!sellPrice || Number(sellPrice) <= 0}
                                                            className={`w-full py-4 rounded-2xl font-black text-base transition-all active:scale-95 ${sellPrice && Number(sellPrice) > 0 ? 'bg-white text-black hover:bg-white/90 shadow-xl' : 'bg-white/10 text-white/30 cursor-not-allowed'}`}
                                                        >
                                                            CONFIRM LISTING
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })()}
                            </div>
                        </div>
                    </div>
                </>
            )}
        </>
    );
}
