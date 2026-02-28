'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

type MarketTab = 'themes' | 'skins' | 'dice';

interface MarketItem {
    id: string;
    type: MarketTab;
    name: string;
    description: string;
    price: number;
    currency: 'coins' | 'gems';
    owned: boolean;
    previewColor: string;
    previewIcon?: React.ReactNode;
}

interface MarketplacePanelProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function MarketplacePanel({ isOpen, onClose }: MarketplacePanelProps) {
    const [activeTab, setActiveTab] = useState<MarketTab>('themes');

    // MOCK DATA: Premium Goods
    const getMarketItems = (tab: MarketTab): MarketItem[] => {
        const items: MarketItem[] = [
            // Themes
            { id: 't1', type: 'themes', name: 'Midnight', description: 'Deep space aesthetic.', price: 5000, currency: 'coins', owned: true, previewColor: 'bg-[#0a0b14]' },
            { id: 't2', type: 'themes', name: 'Cyberpunk', description: 'Neon lights and glitch.', price: 50, currency: 'gems', owned: false, previewColor: 'bg-fuchsia-900', previewIcon: <div className="text-fuchsia-400">⚡</div> },
            { id: 't3', type: 'themes', name: 'Golden Era', description: 'Luxury royal theme.', price: 10000, currency: 'coins', owned: false, previewColor: 'bg-yellow-900/50' },

            // Skins
            { id: 's1', type: 'skins', name: 'Crystal', description: 'Translucent tokens.', price: 15, currency: 'gems', owned: false, previewColor: 'bg-cyan-500/30' },
            { id: 's2', type: 'skins', name: 'Magma', description: 'Animated lava flow.', price: 3000, currency: 'coins', owned: true, previewColor: 'bg-orange-600' },
            { id: 's3', type: 'skins', name: 'Void', description: 'Absorbs all light.', price: 100, currency: 'gems', owned: false, previewColor: 'bg-black' },

            // Dice
            { id: 'd1', type: 'dice', name: 'Classic Red', description: 'The original feel.', price: 0, currency: 'coins', owned: true, previewColor: 'bg-red-500' },
            { id: 'd2', type: 'dice', name: 'Glass D6', description: 'See-through glass.', price: 1200, currency: 'coins', owned: false, previewColor: 'bg-white/10' },
            { id: 'd3', type: 'dice', name: 'Dragon Eye', description: 'Watch it roll.', price: 25, currency: 'gems', owned: false, previewColor: 'bg-emerald-900' },
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
                        <div className="px-6 pb-4 border-b border-white/10">
                            <div className="flex items-center justify-between mb-6 mt-2">
                                <h2 className="text-2xl font-bold text-white flex items-center gap-3">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6 text-fuchsia-400">
                                        <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
                                        <path d="M3 6h18" />
                                        <path d="M16 10a4 4 0 0 1-8 0" />
                                    </svg>
                                    Marketplace
                                </h2>
                                <button onClick={onClose} className="p-2 rounded-full bg-white/5 hover:bg-white/10 text-white/70 transition-colors">
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                </button>
                            </div>

                            {/* Pill Switcher */}
                            <div className="flex bg-black/40 p-1 rounded-xl">
                                {(['themes', 'skins', 'dice'] as MarketTab[]).map((tab) => (
                                    <button
                                        key={tab}
                                        className={`flex-1 py-2 text-[13px] font-bold rounded-lg capitalize transition-all ${activeTab === tab ? 'bg-fuchsia-600 text-white shadow-md' : 'text-white/50 hover:text-white/80'}`}
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
                                        initial={{ opacity: 0, scale: 0.9 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        className="bg-white/5 border border-white/10 rounded-2xl p-3 flex flex-col group hover:bg-white/10 transition-colors"
                                    >
                                        {/* Preview Area */}
                                        <div className={`aspect-square w-full rounded-xl ${item.previewColor} mb-3 border border-white/5 flex items-center justify-center text-3xl shadow-inner relative overflow-hidden`}>
                                            {item.previewIcon}
                                            {item.owned && (
                                                <div className="absolute top-2 right-2 bg-green-500 rounded-full p-1 shadow-lg">
                                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 text-white"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                                </div>
                                            )}
                                        </div>

                                        {/* Info */}
                                        <div className="flex flex-col flex-1">
                                            <h3 className="text-sm font-bold text-white mb-0.5 truncate">{item.name}</h3>
                                            <p className="text-[10px] text-white/40 mb-3 line-clamp-1">{item.description}</p>

                                            {/* Action Button */}
                                            <button
                                                disabled={item.owned}
                                                className={`w-full py-2 rounded-lg text-[11px] font-black transition-all flex items-center justify-center gap-1.5
                                                    ${item.owned
                                                        ? 'bg-white/5 text-white/30 border border-white/10 cursor-default'
                                                        : 'bg-white/10 hover:bg-white/20 text-white border border-white/10 active:scale-95'
                                                    }
                                                `}
                                            >
                                                {item.owned ? (
                                                    'OWNED'
                                                ) : (
                                                    <>
                                                        {item.currency === 'coins' ? (
                                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 text-yellow-400">
                                                                <circle cx="12" cy="12" r="8"></circle>
                                                                <line x1="12" y1="8" x2="12" y2="16"></line>
                                                                <path d="M16 12H8"></path>
                                                            </svg>
                                                        ) : (
                                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 text-cyan-400">
                                                                <path d="M6 3h12l4 6-10 13L2 9z"></path>
                                                                <path d="M11 3 8 9l4 13 4-13-3-6"></path>
                                                            </svg>
                                                        )}
                                                        {item.price}
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
