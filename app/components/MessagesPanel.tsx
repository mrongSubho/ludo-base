'use client';

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

import { useMessages, Conversation, MessageData } from '@/hooks/useMessages';
import { useCurrentUser } from '@/hooks/useCurrentUser';

interface MessagesPanelProps {
    onClose: () => void;
    initialChatId?: string | null;
    onOpenProfile?: (address: string) => void;
}

export default function MessagesPanel({ onClose, initialChatId, onOpenProfile }: MessagesPanelProps) {
    const { address } = useCurrentUser();
    const { messages, conversations, sendMessage, markAsRead, deleteMessageLocal } = useMessages(address);

    const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
    const [inputValue, setInputValue] = useState('');
    const [cooldownTime, setCooldownTime] = useState(0);

    const activeChat = conversations.find(c => c.id.toLowerCase() === selectedChatId?.toLowerCase()) || (selectedChatId ? {
        id: selectedChatId,
        name: `User ${selectedChatId.substring(0, 6)}`,
        avatar: '1',
        lastMessage: '',
        time: 'Just now',
        unread: false,
        status: 'Offline',
        timestamp: Date.now()
    } as Conversation : null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const lastAddressRef = useRef<string | undefined>(address);

    // Cooldown Timer
    useEffect(() => {
        if (!address) return;
        // Load initial cooldown from localStorage scoped to user
        const storedCooldownEnd = localStorage.getItem(`chat_cooldown_end_${address.toLowerCase()}`);
        if (storedCooldownEnd) {
            const end = parseInt(storedCooldownEnd);
            const now = Date.now();
            if (end > now) {
                setCooldownTime(Math.ceil((end - now) / 1000));
            }
        }
    }, [address]);

    useEffect(() => {
        if (cooldownTime > 0) {
            const timer = setTimeout(() => setCooldownTime(c => c - 1), 1000);
            return () => clearTimeout(timer);
        }
    }, [cooldownTime]);

    // Auto-select initial chat if provided
    useEffect(() => {
        if (initialChatId) {
            setSelectedChatId(initialChatId);
        }
    }, [initialChatId]);

    // Reset selection if account changes
    useEffect(() => {
        if (address && lastAddressRef.current && address.toLowerCase() !== lastAddressRef.current.toLowerCase()) {
            setSelectedChatId(null);
            setInputValue('');
        }
        lastAddressRef.current = address;
    }, [address]);

    // Mark as read when opening a chat
    useEffect(() => {
        if (selectedChatId && activeChat?.unread) {
            markAsRead(selectedChatId);
        }
    }, [selectedChatId, activeChat?.unread, messages]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [selectedChatId, messages]);

    const handleSendMessage = async () => {
        if (!inputValue.trim() || !selectedChatId || !address || cooldownTime > 0) return;
        const textToSent = inputValue.slice(0, 140); // Hard limit safety
        setInputValue(''); // Clear aggressively so it feels responsive

        const newCooldown = 10;
        setCooldownTime(newCooldown); // Start 10 second slow-mode
        localStorage.setItem(`chat_cooldown_end_${address.toLowerCase()}`, (Date.now() + newCooldown * 1000).toString());

        await sendMessage(selectedChatId, textToSent);
    };

    const handleDeleteSwipe = (msg: MessageData, info: any) => {
        // If swiped left or right significantly, trigger delete
        if (Math.abs(info.offset.x) > 100) {
            deleteMessageLocal(msg);
        }
    };

    return (
        <>
            {/* Backdrop */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Main Panel */}
            <motion.div
                initial={{ y: '-100%', opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: '-100%', opacity: 0 }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                /* Unified global panel layout: top-64, bottom-80, bg-purple-6000 glass */
                className="fixed top-[64px] bottom-[80px] left-1/2 -translate-x-1/2 w-[calc(100%-32px)] max-w-[468px] bg-purple-600/20 backdrop-blur-xl border border-white/10 rounded-[32px] z-[110] flex flex-col shadow-2xl overflow-hidden"
            >
                {/* Handle Bar */}
                <div className="w-full flex justify-center pt-4 pb-2" onClick={onClose}>
                    <div className="w-12 h-1.5 bg-white/20 rounded-full" />
                </div>

                {/* Header */}
                <div className="px-panel-gutter pb-4 border-b border-white/10">
                    <div className="flex items-center justify-between mt-2">
                        <div className="flex items-center gap-2">
                            {activeChat ? (
                                <button
                                    onClick={() => setSelectedChatId(null)}
                                    className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 text-white/70 hover:bg-white/10 transition-all"
                                >
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                                        <polyline points="15 18 9 12 15 6"></polyline>
                                    </svg>
                                </button>
                            ) : (
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6 text-purple-400">
                                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                                </svg>
                            )}
                            <h2 className="text-2xl font-bold text-white">
                                {activeChat ? activeChat.name : 'Messages'}
                            </h2>
                        </div>

                        <button
                            onClick={onClose}
                            className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-all ring-1 ring-white/10 shadow-sm"
                        >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-hidden relative">
                    <AnimatePresence mode="wait">
                        {!selectedChatId ? (
                            /* Chat List */
                            <motion.div
                                key="list"
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                                className="h-full overflow-y-auto px-panel-gutter py-4 space-y-2 custom-scrollbar"
                            >
                                {conversations.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center h-full text-white/40 mt-10">
                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="w-12 h-12 mb-4 opacity-50"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                                        <p>No messages yet.</p>
                                    </div>
                                ) : (
                                    conversations.map((chat) => (
                                        <div
                                            key={chat.id}
                                            className="w-full flex items-center gap-4 p-3 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/5 transition-all group"
                                        >
                                            <button
                                                onClick={() => onOpenProfile?.(chat.id)}
                                                className="relative w-12 h-12 rounded-full overflow-hidden bg-white/10 flex-shrink-0 hover:scale-105 transition-transform focus:outline-none focus:ring-2 focus:ring-cyan-500"
                                            >
                                                <img src={`/avatars/${chat.avatar || '1'}.png`} alt={chat.name} className="w-full h-full object-cover" />
                                                <div className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-[#1a1c29] 
                                                    ${chat.status === 'Online' ? 'bg-green-500' : chat.status === 'In Match' ? 'bg-orange-500' : 'bg-gray-500'}`}
                                                />
                                            </button>

                                            <button
                                                onClick={() => setSelectedChatId(chat.id)}
                                                className="flex-1 text-left min-w-0 focus:outline-none"
                                            >
                                                <div className="flex justify-between items-center mb-0.5">
                                                    <span className="font-bold text-white truncate">{chat.name}</span>
                                                    <span className="text-[10px] text-white/40">{chat.time}</span>
                                                </div>
                                                <p className={`text-sm truncate ${chat.unread ? 'text-white font-medium' : 'text-white/50'}`}>
                                                    {chat.lastMessage}
                                                </p>
                                            </button>

                                            {chat.unread && (
                                                <div className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.8)] flex-shrink-0" />
                                            )}
                                        </div>
                                    ))
                                )}
                            </motion.div>
                        ) : (
                            /* Chat Detail */
                            <motion.div
                                key={`detail-${selectedChatId?.toLowerCase()}`}
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 20 }}
                                className="flex flex-col h-full"
                            >
                                <div
                                    ref={scrollRef}
                                    className="flex-1 overflow-y-auto px-panel-gutter py-4 space-y-4 custom-scrollbar"
                                >
                                    {messages
                                        .filter(m => {
                                            const sender = m.sender_id.toLowerCase();
                                            const receiver = m.receiver_id.toLowerCase();
                                            const me = address?.toLowerCase();
                                            const friend = selectedChatId.toLowerCase();

                                            // Strict pairwise check: (me -> friend) OR (friend -> me)
                                            return (sender === me && receiver === friend) || (sender === friend && receiver === me);
                                        })
                                        .map((msg) => {
                                            const isMe = msg.sender_id.toLowerCase() === address?.toLowerCase();
                                            const timeString = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                                            return (
                                                <div
                                                    key={msg.id}
                                                    className={`flex flex-col relative w-full ${isMe ? 'items-end' : 'items-start'}`}
                                                >
                                                    {/* Hidden Trash Background behind swipe */}
                                                    <div className={`absolute inset-0 flex items-center ${isMe ? 'justify-start pl-4' : 'justify-end pr-4'} text-red-500 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none`}>
                                                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                                                    </div>

                                                    <motion.div
                                                        drag="x"
                                                        dragConstraints={{ left: -120, right: 120 }}
                                                        onDragEnd={(e, info) => handleDeleteSwipe(msg, info)}
                                                        whileDrag={{ scale: 0.95 }}
                                                        className={`max-w-[80%] flex flex-col z-10 ${isMe ? 'items-end' : 'items-start'} ${msg.send_status === 'sending' ? 'opacity-50' : ''}`}
                                                    >
                                                        <div className={`py-3 px-4 rounded-2xl text-[15px] shadow-sm ${isMe
                                                            ? (msg.send_status === 'failed' ? 'bg-red-600 text-white rounded-tr-none' : 'bg-purple-700 text-white rounded-tr-none')
                                                            : 'bg-white/10 text-white/90 rounded-tl-none border border-white/5'
                                                            }`}>
                                                            {msg.content}
                                                        </div>
                                                        {msg.send_status === 'failed' ? (
                                                            <span className="text-[10px] text-red-400 mt-1 px-1 font-bold">Failed to send</span>
                                                        ) : (
                                                            <span className="text-[10px] text-white/30 mt-1 px-1">{msg.send_status === 'sending' ? 'Sending...' : timeString} (swipe to delete)</span>
                                                        )}
                                                    </motion.div>
                                                </div>
                                            );
                                        })}
                                </div>

                                {/* Input Area */}
                                <div className="px-panel-gutter pt-4 pb-8 border-t border-white/10 bg-black/20">
                                    <div className="flex gap-2 relative">
                                        <input
                                            type="text"
                                            value={inputValue}
                                            maxLength={140}
                                            onChange={(e) => setInputValue(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                                            disabled={cooldownTime > 0}
                                            placeholder={cooldownTime > 0 ? `Wait ${cooldownTime}s...` : "Type a message..."}
                                            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-purple-600/50 transition-colors disabled:opacity-50"
                                        />
                                        <div className={`absolute right-16 top-1/2 -translate-y-1/2 text-[10px] pointer-events-none transition-colors ${inputValue.length >= 130 ? 'text-red-400 font-bold' : 'text-white/20'
                                            }`}>
                                            {inputValue.length}/140
                                        </div>
                                        <button
                                            onClick={handleSendMessage}
                                            disabled={!inputValue.trim() || cooldownTime > 0}
                                            className="w-12 h-12 flex items-center justify-center rounded-xl bg-purple-700 text-white disabled:opacity-50 disabled:bg-white/10 transition-all hover:bg-purple-600 relative overflow-hidden"
                                        >
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                                                <line x1="22" y1="2" x2="11" y2="13"></line>
                                                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                                            </svg>
                                            {cooldownTime > 0 && (
                                                <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-xs font-bold text-white backdrop-blur-sm">
                                                    {cooldownTime}s
                                                </div>
                                            )}
                                        </button>
                                    </div>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </motion.div>
        </>
    );
}
