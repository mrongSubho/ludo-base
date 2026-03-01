'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

type MarketTab = 'items' | 'themes' | 'dice';
type Rarity = 'common' | 'rare' | 'legendary';

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

interface MarketplacePanelProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function MarketplacePanel({ isOpen, onClose }: MarketplacePanelProps) {
    // Industrial State Management
    const [marketData, setMarketData] = useState<MarketItem[]>([
        // Themes
        {
            id: 't1', type: 'themes', name: 'Midnight',
            description: 'Deep space aesthetic for focused gaming.',
            lore: 'Forged in the heart of a dying star, the Midnight theme brings the calm of the void to your board. It is said that those who play on this board can hear the faint whispers of the cosmos.',
            price: 12.50, owned: true, rarity: 'common', collection: 'Cosmos Series', creator: 'StellarForge',
            collectionStats: { floor: 8.2, volume: 4200, owners: 1560 },
            stats: [{ label: 'Focus', value: '+15%' }, { label: 'Rarity Score', value: '420' }],
            traits: [
                { trait_type: 'Environment', value: 'Void', rarity_percent: 15 },
                { trait_type: 'Contrast', value: 'High', rarity_percent: 30 }
            ],
            activity: [
                { event: 'Sale', from: '0x123...abc', to: 'Player', price: 12.0, date: '1d ago' },
                { event: 'Created', from: 'System', to: '0x123...abc', date: '1mo ago' }
            ],
            chainInfo: { address: '0x812...e9f', standard: 'ERC-721', network: 'Base' },
            previewColor: 'bg-[#0a0b14]'
        },
        {
            id: 't2', type: 'themes', name: 'Cyberpunk',
            description: 'Neon lights and glitch aesthetic.',
            lore: 'In the year 2099, Ludo isn\'t just a game—it\'s a high-stakes digital battle. The Cyberpunk theme pulses with the energy of a thousand neon signs and the grit of the underground.',
            price: 45.00, owned: false, rarity: 'legendary', collection: 'Neo-Tokyo', creator: 'GlitchMaster',
            collectionStats: { floor: 38.5, volume: 1250, owners: 840 },
            stats: [{ label: 'Energy', value: 'MAX' }, { label: 'Style', value: '99/100' }],
            traits: [
                { trait_type: 'Core', value: 'Neon Pulse', rarity_percent: 2 },
                { trait_type: 'Glitch', value: 'Level 5', rarity_percent: 5 },
                { trait_type: 'Style', value: 'Technoir', rarity_percent: 12 }
            ],
            activity: [
                { event: 'Sale', from: '0x8a2...11b', to: '0x3c2...ef9', price: 42.5, date: '2d ago' },
                { event: 'Transfer', from: '0x000...000', to: '0x8a2...11b', date: '5d ago' },
                { event: 'Created', from: 'System', to: '0x000...000', date: '10d ago' }
            ],
            chainInfo: { address: '0x3a1...bc2', standard: 'ERC-721', network: 'Base' },
            previewColor: 'bg-fuchsia-900', previewIcon: <div className="text-fuchsia-400">⚡</div>
        },
        {
            id: 't3', type: 'themes', name: 'Golden Era',
            description: 'Luxury royal theme for winners.',
            lore: 'The Golden Era theme was commissioned by the High King of Ludo-Land. Every tile is plated in pure 24k digital gold, ensuring your victory is as stylish as it is absolute.',
            price: 25.00, owned: false, rarity: 'rare', collection: 'Royal Treasury', creator: 'MidasTouch',
            collectionStats: { floor: 18.0, volume: 8500, owners: 2100 },
            stats: [{ label: 'Luck', value: '+5%' }, { label: 'Prestige', value: '88' }],
            traits: [
                { trait_type: 'Material', value: '24k Gold', rarity_percent: 8 },
                { trait_type: 'Finish', value: 'Polished', rarity_percent: 45 }
            ],
            activity: [
                { event: 'Sale', from: '0x771...aa2', to: '0xbb2...cc1', price: 24.0, date: '1h ago' },
                { event: 'Created', from: 'System', to: '0x771...aa2', date: '3d ago' }
            ],
            chainInfo: { address: '0xf5e...11a', standard: 'ERC-721', network: 'Base' },
            previewColor: 'bg-yellow-900/50'
        },
        // Items
        {
            id: 's1', type: 'items', name: 'Crystal',
            description: 'Translucent tokens with prismatic reflections.',
            lore: 'Carved from the ice of the Northern Peaks, these Crystal tokens refract light into a dazzling spectrum of colors. Fragile in appearance, but unbreakable in spirit.',
            price: 8.99, owned: false, rarity: 'rare', collection: 'Elemental', creator: 'FrostByte',
            collectionStats: { floor: 5.5, volume: 12000, owners: 4500 },
            stats: [{ label: 'Clarity', value: '98%' }, { label: 'Durability', value: 'Hard' }],
            traits: [
                { trait_type: 'Element', value: 'Ice', rarity_percent: 25 },
                { trait_type: 'Transparency', value: '98%', rarity_percent: 15 }
            ],
            activity: [
                { event: 'Sale', from: '0x441...111', to: '0x222...333', price: 8.5, date: '6h ago' },
                { event: 'Created', from: 'System', to: '0x441...111', date: '1w ago' }
            ],
            chainInfo: { address: '0x123...456', standard: 'ERC-1155', network: 'Base' },
            previewColor: 'bg-cyan-500/30'
        },
        {
            id: 's2', type: 'items', name: 'Magma',
            description: 'Tokens born from volcanic fire.',
            lore: 'Don\'t touch the edges. These tokens are literal chunks of cooled magma, still glowing with the inner heat of the earth. Perfect for players with a fiery competitive streak.',
            price: 15.00, owned: true, rarity: 'rare', collection: 'Elemental', creator: 'Vulcan',
            collectionStats: { floor: 5.5, volume: 12000, owners: 4500 },
            stats: [{ label: 'Heat', value: 'High' }, { label: 'Mass', value: 'Heavy' }],
            traits: [
                { trait_type: 'Element', value: 'Fire', rarity_percent: 25 },
                { trait_type: 'Temperature', value: 'Extreme', rarity_percent: 10 }
            ],
            activity: [
                { event: 'Transfer', from: '0x888...999', to: 'Player', date: '12h ago' },
                { event: 'Sale', from: '0x555...666', to: '0x888...999', price: 14.0, date: '1d ago' }
            ],
            chainInfo: { address: '0x987...654', standard: 'ERC-1155', network: 'Base' },
            previewColor: 'bg-orange-600'
        },
        {
            id: 's3', type: 'items', name: 'Void',
            description: 'Tokens that absorb all surrounding light.',
            lore: 'Nothingness. The Void tokens occupy space without reflecting a single photon. They are a reminder that in the end, the board always wins. Use with caution.',
            price: 99.00, owned: false, rarity: 'legendary', collection: 'The Unknown', creator: 'Shadow',
            collectionStats: { floor: 75.0, volume: 500, owners: 120 },
            stats: [{ label: 'Stealth', value: '100' }, { label: 'Gravity', value: 'Stable' }],
            traits: [
                { trait_type: 'Material', value: 'Dark Matter', rarity_percent: 1 },
                { trait_type: 'Reflection', value: '0%', rarity_percent: 1 }
            ],
            activity: [
                { event: 'Sale', from: '0xaaa...bbb', to: '0xccc...ddd', price: 95.0, date: '3d ago' },
                { event: 'Created', from: 'System', to: '0xaaa...bbb', date: '1mo ago' }
            ],
            chainInfo: { address: '0xabc...def', standard: 'ERC-1155', network: 'Base' },
            previewColor: 'bg-black'
        },
        // Dice
        {
            id: 'd1', type: 'dice', name: 'Classic Red',
            description: 'The reliable choice for every player.',
            lore: 'Sometimes, the old ways are the best. This Classic Red dice has rolled more sixes than any other in history. It\'s balanced, weighted, and ready for action.',
            price: 0, owned: true, rarity: 'common', collection: 'Foundations', creator: 'LudoCorp',
            collectionStats: { floor: 0, volume: 100000, owners: 50000 },
            stats: [{ label: 'Reliability', value: 'Tier 1' }],
            traits: [
                { trait_type: 'Color', value: 'Red', rarity_percent: 100 },
                { trait_type: 'Style', value: 'Legacy', rarity_percent: 100 }
            ],
            activity: [
                { event: 'Created', from: 'System', to: 'Player', date: 'Genesis' }
            ],
            chainInfo: { address: '0x000...000', standard: 'SBT', network: 'Base' },
            previewColor: 'bg-red-500'
        },
        {
            id: 'd2', type: 'dice', name: 'Glass D6',
            description: 'See the mechanics of chance.',
            lore: 'A transparent masterpiece. The Glass D6 allows you to see the internal weight distribution, proving that every roll is fair. Or is it just an illusion?',
            price: 5.50, owned: false, rarity: 'common', collection: 'Prism', creator: 'Lux',
            collectionStats: { floor: 4.2, volume: 15600, owners: 3200 },
            stats: [{ label: 'Transparency', value: 'Full' }],
            traits: [
                { trait_type: 'Material', value: 'Glass', rarity_percent: 20 },
                { trait_type: 'Weight', value: 'Balanced', rarity_percent: 50 }
            ],
            activity: [
                { event: 'Sale', from: '0xeee...fff', to: '0x111...222', price: 5.2, date: '2d ago' },
                { event: 'Created', from: 'System', to: '0xeee...fff', date: '2w ago' }
            ],
            chainInfo: { address: '0xddd...eee', standard: 'ERC-1155', network: 'Base' },
            previewColor: 'bg-white/10'
        },
        {
            id: 'd3', type: 'dice', name: 'Dragon Eye',
            description: 'A dice that watches your every move.',
            lore: 'The pupil of a Dragon Eye dice dilates when it sees a winning combination. Beware: it is said the dice chooses the player, not the other way around.',
            price: 32.00, owned: false, rarity: 'legendary', collection: 'Mythic', creator: 'AncientOnes',
            collectionStats: { floor: 28.0, volume: 2200, owners: 450 },
            stats: [{ label: 'Vision', value: 'Dark' }, { label: 'Agility', value: '+12' }],
            traits: [
                { trait_type: 'Eye Color', value: 'Emerald', rarity_percent: 3 },
                { trait_type: 'Glow', value: 'Active', rarity_percent: 10 }
            ],
            activity: [
                { event: 'Sale', from: '0x777...888', to: '0x999...000', price: 30.0, date: '1d ago' },
                { event: 'Created', from: 'System', to: '0x777...888', date: '1mo ago' }
            ],
            chainInfo: { address: '0x777...888', standard: 'ERC-721', network: 'Base' },
            previewColor: 'bg-emerald-900'
        },
        { id: 't7', type: 'themes', name: 'Noir', description: 'Dark theme.', lore: 'Pure darkness.', price: 5, owned: false, rarity: 'common', collection: 'Classic', creator: 'X', collectionStats: { floor: 4, volume: 100, owners: 200 }, stats: [], traits: [], activity: [], chainInfo: { address: '0x', standard: 'ERC', network: 'B' }, previewColor: 'bg-black' },
        { id: 't8', type: 'themes', name: 'Solar', description: 'Sun theme.', lore: 'Blinding light.', price: 50, owned: false, rarity: 'legendary', collection: 'Astral', creator: 'X', collectionStats: { floor: 40, volume: 1000, owners: 50 }, stats: [], traits: [], activity: [], chainInfo: { address: '0x', standard: 'ERC', network: 'B' }, previewColor: 'bg-yellow-600' },
        { id: 's4', type: 'items', name: 'Neon-X', description: 'Electric skin.', lore: 'Pulsing neon.', price: 5, owned: false, rarity: 'common', collection: 'Core', creator: 'G', collectionStats: { floor: 4, volume: 100, owners: 200 }, stats: [], traits: [], activity: [], chainInfo: { address: '0x1', standard: 'ERC', network: 'B' }, previewColor: 'bg-blue-500' },
        { id: 's5', type: 'items', name: 'Cyber-V', description: 'Matrix skin.', lore: 'The digital frontier.', price: 12, owned: false, rarity: 'rare', collection: 'Core', creator: 'G', collectionStats: { floor: 4, volume: 100, owners: 200 }, stats: [], traits: [], activity: [], chainInfo: { address: '0x1', standard: 'ERC', network: 'B' }, previewColor: 'bg-purple-500' },
        { id: 's6', type: 'items', name: 'Steel-Z', description: 'Metal skin.', lore: 'Cold steel.', price: 2, owned: false, rarity: 'common', collection: 'Core', creator: 'G', collectionStats: { floor: 4, volume: 100, owners: 200 }, stats: [], traits: [], activity: [], chainInfo: { address: '0x1', standard: 'ERC', network: 'B' }, previewColor: 'bg-gray-500' },
        { id: 'd4', type: 'dice', name: 'Ice D6', description: 'Cold dice.', lore: 'Frozen in time.', price: 10, owned: false, rarity: 'rare', collection: 'Elemental', creator: 'X', collectionStats: { floor: 8, volume: 500, owners: 100 }, stats: [], traits: [], activity: [], chainInfo: { address: '0x', standard: 'ERC', network: 'B' }, previewColor: 'bg-blue-200' },
        { id: 'd5', type: 'dice', name: 'Fire D6', description: 'Hot dice.', lore: 'Molten core.', price: 10, owned: false, rarity: 'rare', collection: 'Elemental', creator: 'X', collectionStats: { floor: 8, volume: 500, owners: 100 }, stats: [], traits: [], activity: [], chainInfo: { address: '0x', standard: 'ERC', network: 'B' }, previewColor: 'bg-red-500' },
        { id: 'd6', type: 'dice', name: 'Bone D6', description: 'Old dice.', lore: 'Ancient remains.', price: 5, owned: false, rarity: 'common', collection: 'History', creator: 'X', collectionStats: { floor: 2, volume: 50, owners: 500 }, stats: [], traits: [], activity: [], chainInfo: { address: '0x', standard: 'ERC', network: 'B' }, previewColor: 'bg-orange-100' },
        { id: 'd7', type: 'dice', name: 'Void D6', description: 'Dark dice.', lore: 'Event horizon.', price: 100, owned: false, rarity: 'legendary', collection: 'Void', creator: 'X', collectionStats: { floor: 90, volume: 1000, owners: 10 }, stats: [], traits: [], activity: [], chainInfo: { address: '0x', standard: 'ERC', network: 'B' }, previewColor: 'bg-black' },
        { id: 'd8', type: 'dice', name: 'Lava D6', description: 'Flowing dice.', lore: 'Liquid rock.', price: 40, owned: false, rarity: 'rare', collection: 'Elemental', creator: 'X', collectionStats: { floor: 35, volume: 300, owners: 80 }, stats: [], traits: [], activity: [], chainInfo: { address: '0x', standard: 'ERC', network: 'B' }, previewColor: 'bg-orange-800' },
    ]);

    const [activeTab, setActiveTab] = useState<MarketTab>('items');
    const [selectedItem, setSelectedItem] = useState<MarketItem | null>(null);
    const [isSelling, setIsSelling] = useState(false);
    const [sellPrice, setSellPrice] = useState('');
    const [listingDuration, setListingDuration] = useState<'7d' | '30d' | 'indefinite'>('7d');
    const [isProcessing, setIsProcessing] = useState(false);
    const [transactionResult, setTransactionResult] = useState<'success' | 'error' | null>(null);

    // Industrial Logic: Handle Purchase
    const handleBuy = async () => {
        if (!selectedItem) return;
        setIsProcessing(true);
        setTransactionResult(null);

        // Simulate Base Blockchain Sequencing
        await new Promise(resolve => setTimeout(resolve, 2000));

        setMarketData(prev => prev.map(item => {
            if (item.id === selectedItem.id) {
                const newActivity: MarketActivity = {
                    event: 'Sale',
                    from: 'System',
                    to: 'Player',
                    price: item.price,
                    date: 'Just now'
                };
                return { ...item, owned: true, activity: [newActivity, ...item.activity] };
            }
            return item;
        }));

        setIsProcessing(false);
        setTransactionResult('success');
    };

    // Industrial Logic: Handle Listing
    const handleConfirmListing = async () => {
        if (!selectedItem || !sellPrice) return;
        setIsProcessing(true);
        setTransactionResult(null);

        // Simulate Base Blockchain Sequencing
        await new Promise(resolve => setTimeout(resolve, 1500));

        const priceNum = parseFloat(sellPrice);

        setMarketData(prev => prev.map(item => {
            if (item.id === selectedItem.id) {
                const newActivity: MarketActivity = {
                    event: 'List',
                    from: 'Player',
                    to: 'Market',
                    price: priceNum,
                    duration: listingDuration === '7d' ? '7 Days' : listingDuration === '30d' ? '30 Days' : 'Indefinite',
                    date: 'Just now'
                };
                return { ...item, price: priceNum, activity: [newActivity, ...item.activity] };
            }
            return item;
        }));

        setIsProcessing(false);
        setTransactionResult('success');
    };

    // Reset selling state when closing detail view
    const handleCloseDetail = () => {
        setSelectedItem(null);
        setIsSelling(false);
        setSellPrice('');
        setIsProcessing(false);
        setTransactionResult(null);
    };

    const currentItems = marketData.filter(i => i.type === activeTab);

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
                        onClick={onClose}
                    />

                    {/* Panel */}
                    <motion.div
                        initial={{ y: '100%' }}
                        animate={{ y: 0 }}
                        exit={{ y: '100%' }}
                        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                        className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[500px] h-[85vh] bg-[#1a1c29]/20 backdrop-blur-xl border-t border-white/10 rounded-t-[32px] z-50 flex flex-col shadow-2xl overflow-hidden"
                    >
                        {/* Drag Handle */}
                        <div className="w-full flex justify-center pt-4 pb-2" onClick={onClose}>
                            <div className="w-12 h-1.5 bg-white/20 rounded-full" />
                        </div>

                        {/* Transaction Overlays */}
                        <AnimatePresence>
                            {isProcessing && (
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    className="absolute inset-0 z-[100] bg-[#1a1c29]/90 backdrop-blur-md flex flex-col items-center justify-center p-8 text-center"
                                >
                                    <div className="relative mb-6">
                                        <div className="w-20 h-20 bg-blue-600 rounded-full flex items-center justify-center animate-pulse">
                                            <div className="w-12 h-12 bg-white rounded-full" />
                                        </div>
                                        <div className="absolute inset-0 border-4 border-blue-400/30 border-t-white rounded-full animate-spin" />
                                    </div>
                                    <h3 className="text-xl font-black text-white mb-2">Sequencing on Base</h3>
                                    <p className="text-sm text-white/40 max-w-[200px]">Confirming your transaction on the L2 network...</p>
                                </motion.div>
                            )}

                            {transactionResult === 'success' && (
                                <motion.div
                                    initial={{ scale: 0.9, opacity: 0 }}
                                    animate={{ scale: 1, opacity: 1 }}
                                    exit={{ scale: 0.9, opacity: 0 }}
                                    className="absolute inset-0 z-[100] bg-[#1a1c29] flex flex-col items-center justify-center p-8 text-center"
                                >
                                    <div className="w-24 h-24 bg-green-500/10 rounded-full flex items-center justify-center mb-6 shadow-[0_0_50px_rgba(34,197,94,0.2)]">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-12 h-12 text-green-500"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                    </div>
                                    <h3 className="text-3xl font-black text-white mb-2 uppercase tracking-tight">Success!</h3>
                                    <p className="text-white/60 mb-8 max-w-[250px]">
                                        {isSelling ? 'Your item has been listed for sale on the marketplace.' : 'You have successfully acquired this item.'}
                                    </p>

                                    <div className="w-full space-y-3">
                                        <button
                                            onClick={handleCloseDetail}
                                            className="w-full py-4 bg-white text-black rounded-2xl font-black text-base hover:bg-white/90 active:scale-95 transition-all shadow-xl"
                                        >
                                            CONTINUE
                                        </button>
                                        <button className="w-full py-4 bg-white/5 border border-white/10 rounded-2xl font-black text-xs text-white/50 hover:bg-white/10 transition-all uppercase tracking-widest">
                                            View on Explorer
                                        </button>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>

                        {/* Header */}
                        <div className="px-5 pb-3 border-b border-white/10">
                            <div className="flex items-center justify-between mb-4 mt-1">
                                <div className="flex flex-col">
                                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                                        <div className="w-5 h-5 bg-blue-600 rounded-full flex items-center justify-center p-0.5">
                                            <div className="w-full h-full bg-white rounded-full" />
                                        </div>
                                        Marketplace
                                    </h2>
                                    <div className="flex items-center gap-1.5 mt-0.5">
                                        <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                                        <span className="text-[10px] text-white/40 font-mono tracking-wider">BASE MAINNET · 0x71C...892</span>
                                    </div>
                                </div>
                                <button onClick={onClose} className="p-1.5 rounded-full bg-white/5 hover:bg-white/10 text-white/50 transition-colors">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                </button>
                            </div>

                            {/* Pill Switcher */}
                            {!selectedItem && (
                                <div className="flex bg-black/40 p-0.5 rounded-lg">
                                    {(['items', 'themes', 'dice'] as MarketTab[]).map((tab) => (
                                        <button
                                            key={tab}
                                            className={`flex-1 py-1.5 text-[10px] font-black rounded-md capitalize transition-all ${activeTab === tab ? 'bg-white/10 text-white shadow-sm' : 'text-white/30 hover:text-white/60'}`}
                                            onClick={() => setActiveTab(tab)}
                                        >
                                            {tab}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Inventory Grid Container */}
                        <div className="flex-1 overflow-y-auto custom-scrollbar pt-2 px-safe mb-4">
                            <motion.div
                                layout
                                className="grid grid-cols-4 gap-2 pb-safe-footer"
                            >
                                {currentItems.map((item) => (
                                    <motion.div
                                        key={item.id}
                                        layout
                                        initial={{ opacity: 0, scale: 0.8 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        onClick={() => setSelectedItem(item)}
                                        className={`bg-white/5 border rounded-lg p-1 flex flex-col group cursor-pointer hover:bg-white/10 hover:border-white/20 transition-all ${item.rarity === 'legendary' ? 'border-fuchsia-600/30 shadow-[0_0_15px_rgba(192,38,211,0.05)]' :
                                            item.rarity === 'rare' ? 'border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.05)]' : 'border-white/10'
                                            }`}
                                    >
                                        <div className={`aspect-square w-full rounded-md ${item.previewColor} mb-1 border border-white/5 flex items-center justify-center text-lg shadow-inner relative overflow-hidden group-hover:scale-[1.02] transition-transform`}>
                                            <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-50" />
                                            <div className="relative z-10">{item.previewIcon}</div>
                                            {item.rarity === 'legendary' && <div className="absolute inset-0 bg-fuchsia-600/10 blur-md animate-pulse" />}
                                            {item.rarity === 'rare' && <div className="absolute inset-0 bg-blue-500/10 blur-md animate-pulse" />}
                                            <div className="absolute top-0.5 left-0.5 flex gap-1">
                                                <div className="px-1 py-0 rounded-sm bg-black/60 border border-white/5 backdrop-blur-md">
                                                    <span className="text-[6px] font-black text-white/50 tracking-tighter">ITEM</span>
                                                </div>
                                            </div>
                                            {item.owned && (
                                                <div className="absolute top-0.5 right-0.5 bg-green-500 rounded-full p-0.5 shadow-lg z-20">
                                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" className="w-1.5 h-1.5 text-white"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex flex-col flex-1 px-0.5">
                                            <div className="flex items-center justify-between mb-0.5">
                                                <h3 className="text-[8px] font-black text-white truncate max-w-full leading-tight">{item.name}</h3>
                                            </div>
                                            <div className="flex items-center justify-between mt-auto pt-1">
                                                <span className={`text-[6px] font-black tracking-tighter uppercase ${item.rarity === 'legendary' ? 'text-fuchsia-400' :
                                                    item.rarity === 'rare' ? 'text-blue-400' : 'text-white/30'
                                                    }`}>
                                                    {item.rarity[0]}
                                                </span>
                                                <div className="flex items-center gap-0.5">
                                                    <span className="text-[7px] text-white/50 font-mono">$</span>
                                                    <span className="text-[8px] font-black text-white/90 font-mono">{item.price % 1 === 0 ? item.price : item.price.toFixed(2)}</span>
                                                    <span className="text-[6px] text-white/20 font-black ml-0.5">USDC</span>
                                                </div>
                                            </div>
                                        </div>
                                    </motion.div>
                                ))}
                            </motion.div>
                        </div>

                        {/* Product Detail Overlay */}
                        <AnimatePresence>
                            {selectedItem && (
                                <motion.div
                                    initial={{ x: '100%' }}
                                    animate={{ x: 0 }}
                                    exit={{ x: '100%' }}
                                    transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                                    className="absolute inset-x-0 bottom-0 top-[34px] bg-[#1a1c29] border-t border-white/10 z-[60] flex flex-col rounded-t-[24px] overflow-hidden"
                                >
                                    <div className="flex-1 overflow-y-auto custom-scrollbar py-6 px-safe pb-safe-footer text-left">
                                        <div className="flex items-center justify-between mb-8 px-5">
                                            <button
                                                onClick={handleCloseDetail}
                                                className="flex items-center gap-2 text-white/50 hover:text-white transition-colors text-xs font-bold"
                                            >
                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
                                                Back
                                            </button>
                                            <div className="px-3 py-1 bg-white/5 border border-white/10 rounded-full">
                                                <span className="text-[10px] text-white/40 font-mono uppercase tracking-widest">{selectedItem.rarity} collectible</span>
                                            </div>
                                        </div>

                                        <div className={`aspect-square w-full max-w-[280px] mx-auto rounded-3xl ${selectedItem.previewColor} mb-8 border border-white/10 flex items-center justify-center text-6xl shadow-2xl relative overflow-hidden`}>
                                            <div className="absolute inset-0 bg-gradient-to-br from-white/20 to-transparent" />
                                            <div className="relative z-10">{selectedItem.previewIcon}</div>
                                            {selectedItem.rarity === 'legendary' && <div className="absolute inset-0 bg-fuchsia-600/10 blur-3xl animate-pulse" />}
                                        </div>

                                        <div className="px-5">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-[10px] text-white/40 font-bold uppercase tracking-wider">{selectedItem.collection}</span>
                                                <span className="w-1 h-1 bg-white/20 rounded-full" />
                                                <span className="text-[10px] text-blue-400 font-bold">@{selectedItem.creator}</span>
                                            </div>
                                            <h1 className="text-3xl font-black text-white mb-2">{selectedItem.name}</h1>

                                            {/* Collection Analytics Bar */}
                                            <div className="flex gap-4 mb-6 glass-card-sm !rounded-xl">
                                                <div className="flex flex-col">
                                                    <span className="text-[8px] text-white/20 font-black uppercase mb-0.5">Floor</span>
                                                    <span className="text-[10px] text-white/80 font-mono font-bold">{selectedItem.collectionStats.floor} USDC</span>
                                                </div>
                                                <div className="w-px h-6 bg-white/10" />
                                                <div className="flex flex-col">
                                                    <span className="text-[8px] text-white/20 font-black uppercase mb-0.5">Volume</span>
                                                    <span className="text-[10px] text-white/80 font-mono font-bold">{(selectedItem.collectionStats.volume / 1000).toFixed(1)}k</span>
                                                </div>
                                                <div className="w-px h-6 bg-white/10" />
                                                <div className="flex flex-col">
                                                    <span className="text-[8px] text-white/20 font-black uppercase mb-0.5">Owners</span>
                                                    <span className="text-[10px] text-white/80 font-mono font-bold">{selectedItem.collectionStats.owners}</span>
                                                </div>
                                            </div>

                                            <p className="text-white/40 text-sm leading-relaxed mb-6">{selectedItem.description}</p>

                                            {/* Stats Grid */}
                                            <div className="grid grid-cols-2 gap-3 mb-8">
                                                {selectedItem.stats.map((stat, i) => (
                                                    <div key={i} className="glass-card-sm !rounded-xl flex flex-col">
                                                        <span className="text-[9px] text-white/30 font-black uppercase tracking-widest mb-1">{stat.label}</span>
                                                        <span className="text-sm font-bold text-white">{stat.value}</span>
                                                    </div>
                                                ))}
                                            </div>

                                            {/* Properties / Traits Grid */}
                                            <div className="mb-8">
                                                <h4 className="text-[10px] text-white/30 font-black uppercase tracking-widest mb-3 px-2">Properties</h4>
                                                <div className="grid grid-cols-3 gap-2">
                                                    {selectedItem.traits.map((trait, i) => (
                                                        <div key={i} className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-2.5 flex flex-col items-center text-center">
                                                            <span className="text-[8px] text-blue-400/60 font-black uppercase mb-0.5">{trait.trait_type}</span>
                                                            <span className="text-[10px] text-white font-bold mb-1 truncate w-full">{trait.value}</span>
                                                            <span className="text-[9px] text-blue-400 font-mono">{trait.rarity_percent}% rarity</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Lore Section */}
                                            <div className="mb-8 glass-card !bg-fuchsia-500/5 !border-fuchsia-500/10 relative overflow-hidden">
                                                <div className="absolute top-0 right-0 p-2 opacity-10 text-fuchsia-400">
                                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-12 h-12"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
                                                </div>
                                                <h4 className="text-[10px] text-fuchsia-400 font-black uppercase tracking-widest mb-2">Item Lore</h4>
                                                <p className="text-xs text-white/60 italic leading-relaxed">{selectedItem.lore}</p>
                                            </div>

                                            {/* Activity Ledger */}
                                            <div className="mb-8">
                                                <h4 className="text-[10px] text-white/30 font-black uppercase tracking-widest mb-3 px-2">Item Activity</h4>
                                                <div className="bg-white/5 border border-white/5 rounded-2xl overflow-hidden text-[10px]">
                                                    {selectedItem.activity.map((act, i) => (
                                                        <div key={i} className={`flex items-center justify-between glass-card !rounded-none !bg-transparent !border-0 ${i !== 0 ? 'border-t border-white/5' : ''}`}>
                                                            <div className="flex items-center gap-2">
                                                                <span className={`w-1.5 h-1.5 rounded-full ${act.event === 'Created' ? 'bg-green-400' : act.event === 'Sale' ? 'bg-blue-400' : act.event === 'List' ? 'bg-orange-400' : 'bg-white/20'}`} />
                                                                <div className="flex flex-col">
                                                                    <span className="text-white font-bold">{act.event}</span>
                                                                    {act.duration && <span className="text-[8px] text-white/30 font-medium">Valid for {act.duration}</span>}
                                                                </div>
                                                            </div>
                                                            <div className="flex flex-col items-end">
                                                                <div className="flex items-center gap-1.5 font-mono text-white/60">
                                                                    <span>{act.from.substring(0, 6)}</span>
                                                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-2 h-2"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
                                                                    <span>{act.to.substring(0, 6)}</span>
                                                                </div>
                                                                <div className="flex items-center gap-2 mt-0.5">
                                                                    {act.price && <span className="text-white font-bold">{act.price} USDC</span>}
                                                                    <span className="text-white/20">{act.date}</span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>

                                            <div className="bg-white/5 border border-white/5 rounded-2xl p-4 mb-4">
                                                <div className="flex items-center justify-between mb-1">
                                                    <span className="text-[10px] text-white/30 font-black uppercase tracking-widest">Listing Price</span>
                                                    <span className="text-[10px] text-green-400 font-black uppercase tracking-widest">Instant Buy</span>
                                                </div>
                                                <div className="flex items-baseline gap-2">
                                                    <span className="text-4xl font-black text-white font-mono">{selectedItem.price.toFixed(2)}</span>
                                                    <span className="text-xl font-bold text-white/30 font-mono">USDC</span>
                                                </div>
                                            </div>

                                            <div className="flex items-center justify-between px-1 mb-20">
                                                <a href="#" className="text-[10px] text-blue-400 font-bold hover:underline flex items-center gap-1">
                                                    View on Explorer
                                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-2.5 h-2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                                                </a>
                                                <button className="text-[10px] text-white/40 font-bold hover:text-white flex items-center gap-1">
                                                    Share Item
                                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-2.5 h-2.5"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path><polyline points="16 6 12 2 8 6"></polyline><line x1="12" y1="2" x2="12" y2="15"></line></svg>
                                                </button>
                                            </div>
                                        </div>

                                        {/* Sell Mode Overlay */}
                                        <AnimatePresence>
                                            {isSelling && (
                                                <motion.div
                                                    initial={{ y: '100%' }}
                                                    animate={{ y: 0 }}
                                                    exit={{ y: '100%' }}
                                                    className="absolute inset-0 bg-[#1a1c29] z-20 flex flex-col py-6 px-5 overflow-hidden"
                                                >
                                                    {/* Industrial Background Glow */}
                                                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(37,99,235,0.1),transparent_70%)] pointer-events-none" />

                                                    <div className="flex items-center justify-between mb-10 relative z-10">
                                                        <h3 className="text-xl font-black text-white">List for Sale</h3>
                                                        <button
                                                            onClick={() => setIsSelling(false)}
                                                            className="text-white/40 hover:text-white transition-colors p-2"
                                                        >
                                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-5 h-5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                                        </button>
                                                    </div>

                                                    <div className="flex-1 overflow-y-auto custom-scrollbar relative z-10">
                                                        <div className="flex items-center gap-4 bg-white/5 p-4 rounded-3xl border border-white/10 mb-8 backdrop-blur-md">
                                                            <div className={`w-16 h-16 rounded-2xl ${selectedItem.previewColor} flex items-center justify-center text-3xl shadow-lg border border-white/5`}>
                                                                {selectedItem.previewIcon}
                                                            </div>
                                                            <div>
                                                                <h4 className="text-sm font-black text-white">{selectedItem.name}</h4>
                                                                <p className="text-[10px] text-white/40 font-bold tracking-wider uppercase">{selectedItem.collection}</p>
                                                            </div>
                                                        </div>

                                                        <div className="mb-6">
                                                            <label className="text-[10px] text-white/30 font-black uppercase tracking-widest mb-3 block px-1">Set Price (USDC)</label>
                                                            <div className="relative group">
                                                                <input
                                                                    type="number"
                                                                    placeholder="0.00"
                                                                    value={sellPrice}
                                                                    onChange={(e) => setSellPrice(e.target.value)}
                                                                    className="w-full bg-white/5 border border-white/10 rounded-2xl p-6 text-3xl font-mono font-black text-white focus:outline-none focus:border-blue-500/50 transition-all placeholder:text-white/10 shadow-inner"
                                                                />
                                                                <div className="absolute right-6 top-1/2 -translate-y-1/2 text-xl font-bold text-white/20">USDC</div>
                                                            </div>
                                                        </div>

                                                        {/* Duration Selector */}
                                                        <div className="mb-8">
                                                            <label className="text-[10px] text-white/30 font-black uppercase tracking-widest mb-3 block px-1">Listing Duration</label>
                                                            <div className="flex bg-white/5 p-1 rounded-2xl border border-white/10">
                                                                {(['7d', '30d', 'indefinite'] as const).map((d) => (
                                                                    <button
                                                                        key={d}
                                                                        onClick={() => setListingDuration(d)}
                                                                        className={`flex-1 py-3 text-[10px] font-black uppercase tracking-wider rounded-xl transition-all ${listingDuration === d ? 'bg-blue-600 text-white shadow-lg' : 'text-white/30 hover:text-white/60'}`}
                                                                    >
                                                                        {d === '7d' ? '7 Days' : d === '30d' ? '30 Days' : 'Indefinite'}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>

                                                        <div className="space-y-4 glass-card mb-8 !bg-white/[0.02]">
                                                            <div className="flex justify-between text-[11px] font-medium">
                                                                <span className="text-white/40">Marketplace Fee</span>
                                                                <span className="text-white font-mono">2.5%</span>
                                                            </div>
                                                            <div className="flex justify-between text-[11px] font-medium">
                                                                <span className="text-white/40">Creator Royalty</span>
                                                                <span className="text-white font-mono">5.0%</span>
                                                            </div>
                                                            <div className="h-px bg-white/10 my-2" />
                                                            <div className="flex justify-between items-center">
                                                                <div className="flex flex-col">
                                                                    <span className="text-xs font-black text-white uppercase tracking-wider">Your Earnings</span>
                                                                    <span className="text-[9px] text-white/20 font-bold italic ring-offset-green-400">Estimated Yield</span>
                                                                </div>
                                                                <div className="flex items-baseline gap-1 text-green-400 relative">
                                                                    {/* Yield Pulse Glow */}
                                                                    {sellPrice && Number(sellPrice) > 0 && (
                                                                        <div className="absolute inset-0 bg-green-400/20 blur-xl animate-pulse" />
                                                                    )}
                                                                    <span className="text-3xl font-black font-mono tracking-tighter relative z-10">
                                                                        {sellPrice ? (Number(sellPrice) * 0.925).toFixed(2) : '0.00'}
                                                                    </span>
                                                                    <span className="text-[10px] font-black relative z-10">USDC</span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div className="flex gap-4 pt-4 mt-auto relative z-10">
                                                        <button
                                                            onClick={() => setIsSelling(false)}
                                                            className="flex-1 py-4 bg-white/5 border border-white/10 rounded-2xl font-black text-xs text-white hover:bg-white/10 transition-all active:scale-95"
                                                        >
                                                            CANCEL
                                                        </button>
                                                        <button
                                                            disabled={!sellPrice || Number(sellPrice) <= 0}
                                                            className="flex-[2] py-4 bg-blue-600 rounded-2xl font-black text-xs text-white hover:bg-blue-500 disabled:opacity-50 disabled:grayscale transition-all shadow-lg active:scale-95 flex items-center justify-center gap-2"
                                                            onClick={handleConfirmListing}
                                                        >
                                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="w-3.5 h-3.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                                                            CONFIRM LISTING
                                                        </button>
                                                    </div>
                                                </motion.div>
                                            )}
                                        </AnimatePresence>

                                        <div className="flex gap-4 sticky bottom-0 bg-[#1a1c29] pt-2 pb-4 px-5">
                                            <button
                                                onClick={selectedItem.owned ? () => setIsSelling(true) : handleBuy}
                                                className="flex-1 py-4 bg-white text-black rounded-2xl font-black text-base hover:bg-white/90 active:scale-95 transition-all shadow-[0_4px_20px_rgba(255,255,255,0.1)]"
                                            >
                                                {selectedItem.owned ? 'SELL' : 'BUY NOW'}
                                            </button>
                                            <button className="p-4 bg-white/5 border border-white/10 rounded-2xl text-white hover:bg-white/10 active:scale-95 transition-all">
                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
                                            </button>
                                        </div>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
