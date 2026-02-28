'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

type MarketTab = 'items' | 'themes' | 'dice';
type Rarity = 'common' | 'rare' | 'legendary';

interface MarketItem {
    id: string;
    type: MarketTab;
    name: string;
    description: string;
    price: number;
    owned: boolean;
    rarity: Rarity;
    previewColor: string;
    previewIcon?: React.ReactNode;
}

interface MarketplacePanelProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function MarketplacePanel({ isOpen, onClose }: MarketplacePanelProps) {
    const [activeTab, setActiveTab] = useState<MarketTab>('items');
    const [selectedItem, setSelectedItem] = useState<MarketItem | null>(null);

    // MOCK DATA: Premium NFT Goods
    const getMarketItems = (tab: MarketTab): MarketItem[] => {
        const items: MarketItem[] = [
            // Themes
            { id: 't1', type: 'themes', name: 'Midnight', description: 'Deep space aesthetic.', price: 12.50, owned: true, rarity: 'common', previewColor: 'bg-[#0a0b14]' },
            { id: 't2', type: 'themes', name: 'Cyberpunk', description: 'Neon lights and glitch.', price: 45.00, owned: false, rarity: 'legendary', previewColor: 'bg-fuchsia-900', previewIcon: <div className="text-fuchsia-400">⚡</div> },
            { id: 't3', type: 'themes', name: 'Golden Era', description: 'Luxury royal theme.', price: 25.00, owned: false, rarity: 'rare', previewColor: 'bg-yellow-900/50' },

            // Items
            { id: 's1', type: 'items', name: 'Crystal', description: 'Translucent tokens.', price: 8.99, owned: false, rarity: 'rare', previewColor: 'bg-cyan-500/30' },
            { id: 's2', type: 'items', name: 'Magma', description: 'Animated lava flow.', price: 15.00, owned: true, rarity: 'rare', previewColor: 'bg-orange-600' },
            { id: 's3', type: 'items', name: 'Void', description: 'Absorbs all light.', price: 99.00, owned: false, rarity: 'legendary', previewColor: 'bg-black' },

            // Dice
            { id: 'd1', type: 'dice', name: 'Classic Red', description: 'The original feel.', price: 0, owned: true, rarity: 'common', previewColor: 'bg-red-500' },
            { id: 'd2', type: 'dice', name: 'Glass D6', description: 'See-through glass.', price: 5.50, owned: false, rarity: 'common', previewColor: 'bg-white/10' },
            { id: 'd3', type: 'dice', name: 'Dragon Eye', description: 'Watch it roll.', price: 32.00, owned: false, rarity: 'legendary', previewColor: 'bg-emerald-900' },
        ];
        return items.filter(i => i.type === tab);
    };

    const currentItems = getMarketItems(activeTab);

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
                        </div>

                        {/* Inventory Grid */}
                        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                            <motion.div
                                layout
                                className="grid grid-cols-4 gap-2 pb-24"
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
                                        {/* Preview Area */}
                                        <div className={`aspect-square w-full rounded-md ${item.previewColor} mb-1 border border-white/5 flex items-center justify-center text-lg shadow-inner relative overflow-hidden group-hover:scale-[1.02] transition-transform`}>
                                            <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-50" />
                                            <div className="relative z-10">{item.previewIcon}</div>

                                            {/* Rarity Glow */}
                                            {item.rarity === 'legendary' && <div className="absolute inset-0 bg-fuchsia-600/10 blur-md animate-pulse" />}
                                            {item.rarity === 'rare' && <div className="absolute inset-0 bg-blue-500/10 blur-md animate-pulse" />}

                                            {/* Badges */}
                                            <div className="absolute top-0.5 left-0.5 flex gap-1">
                                                <div className="px-1 py-0 rounded-sm bg-black/60 border border-white/5 backdrop-blur-md">
                                                    <span className="text-[6px] font-black text-white/50 tracking-tighter">NFT</span>
                                                </div>
                                            </div>

                                            {item.owned && (
                                                <div className="absolute top-0.5 right-0.5 bg-green-500 rounded-full p-0.5 shadow-lg z-20">
                                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" className="w-1.5 h-1.5 text-white"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                                </div>
                                            )}
                                        </div>

                                        {/* Info */}
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

                        {/* Product Detail Overlay (Mock) */}
                        <AnimatePresence>
                            {selectedItem && (
                                <motion.div
                                    initial={{ x: '100%' }}
                                    animate={{ x: 0 }}
                                    exit={{ x: '100%' }}
                                    transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                                    className="absolute inset-x-0 bottom-0 top-[60px] bg-[#1a1c29] border-t border-white/10 z-[60] flex flex-col p-6 rounded-t-[24px]"
                                >
                                    <div className="flex items-center justify-between mb-8">
                                        <button
                                            onClick={() => setSelectedItem(null)}
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

                                    <div className="flex flex-col flex-1">
                                        <h1 className="text-3xl font-black text-white mb-2">{selectedItem.name}</h1>
                                        <p className="text-white/40 text-sm leading-relaxed mb-8">{selectedItem.description}</p>

                                        <div className="bg-white/5 border border-white/5 rounded-2xl p-4 mb-auto">
                                            <div className="flex items-center justify-between mb-1">
                                                <span className="text-[10px] text-white/30 font-black uppercase tracking-widest">Market Price</span>
                                                <span className="text-[10px] text-green-400 font-black uppercase tracking-widest">Available</span>
                                            </div>
                                            <div className="flex items-baseline gap-2">
                                                <span className="text-4xl font-black text-white font-mono">{selectedItem.price}</span>
                                                <span className="text-xl font-bold text-white/30 font-mono">USDC</span>
                                            </div>
                                        </div>

                                        <div className="flex gap-4 mt-8">
                                            <button className="flex-1 py-4 bg-white text-black rounded-2xl font-black text-base hover:bg-white/90 active:scale-95 transition-all">
                                                {selectedItem.owned ? 'SELL NFT' : 'MINT NOW'}
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
