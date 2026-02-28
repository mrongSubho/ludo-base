'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

type MarketTab = 'themes' | 'skins' | 'dice';
type Rarity = 'common' | 'rare' | 'legendary';

interface MarketItem {
    id: string;
    type: MarketTab;
    name: string;
    description: string;
    price: number;
    currency: 'coins' | 'gems' | 'eth';
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
    const [activeTab, setActiveTab] = useState<MarketTab>('themes');

    // MOCK DATA: Premium NFT Goods
    const getMarketItems = (tab: MarketTab): MarketItem[] => {
        const items: MarketItem[] = [
            // Themes
            { id: 't1', type: 'themes', name: 'Midnight', description: 'Deep space aesthetic.', price: 5000, currency: 'coins', owned: true, rarity: 'common', previewColor: 'bg-[#0a0b14]' },
            { id: 't2', type: 'themes', name: 'Cyberpunk', description: 'Neon lights and glitch.', price: 0.05, currency: 'eth', owned: false, rarity: 'legendary', previewColor: 'bg-fuchsia-900', previewIcon: <div className="text-fuchsia-400">⚡</div> },
            { id: 't3', type: 'themes', name: 'Golden Era', description: 'Luxury royal theme.', price: 10000, currency: 'coins', owned: false, rarity: 'rare', previewColor: 'bg-yellow-900/50' },

            // Skins
            { id: 's1', type: 'skins', name: 'Crystal', description: 'Translucent tokens.', price: 0.012, currency: 'eth', owned: false, rarity: 'rare', previewColor: 'bg-cyan-500/30' },
            { id: 's2', type: 'skins', name: 'Magma', description: 'Animated lava flow.', price: 3000, currency: 'coins', owned: true, rarity: 'rare', previewColor: 'bg-orange-600' },
            { id: 's3', type: 'skins', name: 'Void', description: 'Absorbs all light.', price: 0.08, currency: 'eth', owned: false, rarity: 'legendary', previewColor: 'bg-black' },

            // Dice
            { id: 'd1', type: 'dice', name: 'Classic Red', description: 'The original feel.', price: 0, currency: 'coins', owned: true, rarity: 'common', previewColor: 'bg-red-500' },
            { id: 'd2', type: 'dice', name: 'Glass D6', description: 'See-through glass.', price: 1200, currency: 'coins', owned: false, rarity: 'common', previewColor: 'bg-white/10' },
            { id: 'd3', type: 'dice', name: 'Dragon Eye', description: 'Watch it roll.', price: 0.02, currency: 'eth', owned: false, rarity: 'legendary', previewColor: 'bg-emerald-900' },
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
                        className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[500px] h-[85vh] bg-[#1a1c29]/20 backdrop-blur-xl border-t border-white/10 rounded-t-[32px] z-50 flex flex-col shadow-2xl"
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
                                {(['themes', 'skins', 'dice'] as MarketTab[]).map((tab) => (
                                    <button
                                        key={tab}
                                        className={`flex-1 py-1.5 text-[11px] font-black rounded-md capitalize transition-all ${activeTab === tab ? 'bg-white/10 text-white shadow-sm' : 'text-white/30 hover:text-white/60'}`}
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
                                className="grid grid-cols-2 gap-4 pb-24"
                            >
                                {currentItems.map((item) => (
                                    <motion.div
                                        key={item.id}
                                        layout
                                        initial={{ opacity: 0, y: 10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className={`bg-white/5 border rounded-2xl p-2.5 flex flex-col group hover:bg-white/10 transition-all ${item.rarity === 'legendary' ? 'border-fuchsia-600/30' :
                                                item.rarity === 'rare' ? 'border-blue-500/30' : 'border-white/10'
                                            }`}
                                    >
                                        {/* Preview Area */}
                                        <div className={`aspect-square w-full rounded-xl ${item.previewColor} mb-2.5 border border-white/5 flex items-center justify-center text-3xl shadow-inner relative overflow-hidden`}>
                                            <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-50" />
                                            <div className="relative z-10">{item.previewIcon}</div>

                                            {/* Rarity Glow */}
                                            {item.rarity === 'legendary' && <div className="absolute inset-0 bg-fuchsia-600/10 blur-2xl animate-pulse" />}
                                            {item.rarity === 'rare' && <div className="absolute inset-0 bg-blue-500/10 blur-2xl animate-pulse" />}

                                            {/* Badges */}
                                            <div className="absolute top-1.5 left-1.5 flex gap-1">
                                                <div className="px-1.5 py-0.5 rounded-md bg-black/60 border border-white/10 backdrop-blur-md">
                                                    <span className="text-[8px] font-black text-white/70 tracking-tighter">NFT</span>
                                                </div>
                                            </div>

                                            {item.owned && (
                                                <div className="absolute top-1.5 right-1.5 bg-green-500 rounded-full p-0.5 shadow-lg z-20">
                                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" className="w-2.5 h-2.5 text-white"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                                </div>
                                            )}
                                        </div>

                                        {/* Info */}
                                        <div className="flex flex-col flex-1 px-0.5">
                                            <div className="flex items-center justify-between mb-0.5">
                                                <h3 className="text-[12px] font-black text-white truncate">{item.name}</h3>
                                                <span className={`text-[8px] font-black tracking-widest uppercase ${item.rarity === 'legendary' ? 'text-fuchsia-400' :
                                                        item.rarity === 'rare' ? 'text-blue-400' : 'text-white/30'
                                                    }`}>
                                                    {item.rarity}
                                                </span>
                                            </div>
                                            <p className="text-[9px] text-white/30 mb-2.5 line-clamp-1 h-3">{item.description}</p>

                                            {/* Action Button */}
                                            <button
                                                disabled={item.owned}
                                                className={`w-full py-1.5 rounded-lg text-[10px] font-black transition-all flex items-center justify-center gap-1.5
                                                    ${item.owned
                                                        ? 'bg-transparent text-white/20 border border-white/5 cursor-default'
                                                        : 'bg-white/5 hover:bg-white/10 text-white border border-white/10 active:scale-95'
                                                    }
                                                `}
                                            >
                                                {item.owned ? (
                                                    'OWNED'
                                                ) : (
                                                    <>
                                                        {item.currency === 'eth' ? (
                                                            <div className="flex items-center gap-1">
                                                                <svg viewBox="0 0 256 417" className="w-2 h-2.5 fill-white/60"><path d="M127.961 0l-2.795 9.5v275.668l2.795 2.79 127.962-75.638z" /><path d="M127.962 0L0 212.32l127.962 75.638V154.158z" /><path d="M127.961 312.187l-1.575 1.92v98.199l1.575 4.59 128.038-180.32z" /><path d="M127.962 416.905V312.187L0 236.402z" /><path d="M127.961 287.958l127.96-75.637-127.96-58.162z" /><path d="M0 212.32l127.962 75.638V154.158z" /></svg>
                                                                <span className="text-white/60 font-mono tracking-tighter uppercase">Mint</span>
                                                                <span>{item.price}</span>
                                                            </div>
                                                        ) : (
                                                            <div className="flex items-center gap-1">
                                                                {item.currency === 'coins' ? (
                                                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-2.5 h-2.5 text-yellow-400">
                                                                        <circle cx="12" cy="12" r="8"></circle>
                                                                        <line x1="12" y1="8" x2="12" y2="16"></line>
                                                                        <path d="M16 12H8"></path>
                                                                    </svg>
                                                                ) : (
                                                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-2.5 h-2.5 text-cyan-400">
                                                                        <path d="M6 3h12l4 6-10 13L2 9z"></path>
                                                                        <path d="M11 3 8 9l4 13 4-13-3-6"></path>
                                                                    </svg>
                                                                )}
                                                                <span>{item.price}</span>
                                                            </div>
                                                        )}
                                                    </>
                                                )}
                                            </button>
                                        </div>
                                    </motion.div>
                                ))}
                            </motion.div>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
