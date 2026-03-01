'use client';

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface Message {
    id: string;
    text: string;
    sender: 'me' | 'other';
    timestamp: string;
}

interface Conversation {
    id: string;
    name: string;
    avatar: string;
    lastMessage: string;
    time: string;
    unread?: boolean;
    status: 'Online' | 'Offline' | 'In Match';
}

interface MessagesPanelProps {
    onClose: () => void;
    initialChatId?: string | null;
}

const MOCK_CONVERSATIONS: Conversation[] = [
    { id: '1', name: 'AlexD', avatar: '1', lastMessage: 'Good game! Want to play again?', time: '2m ago', unread: true, status: 'In Match' },
    { id: '2', name: 'Sarah_99', avatar: '2', lastMessage: 'I just got the Cyberpunk theme!', time: '1h ago', status: 'Online' },
    { id: '4', name: 'JenPlays', avatar: '4', lastMessage: 'Check out my new dice skin.', time: '3h ago', status: 'Online' },
    { id: '5', name: 'Chris_H', avatar: '3', lastMessage: 'See you tomorrow on the board.', time: '1d ago', status: 'Offline' },
];

const MOCK_MESSAGES: Record<string, Message[]> = {
    '1': [
        { id: 'm1', text: 'Hey, that was a close one!', sender: 'other', timestamp: '10:05 AM' },
        { id: 'm2', text: 'Yeah, really intense at the end.', sender: 'me', timestamp: '10:06 AM' },
        { id: 'm3', text: 'Good game! Want to play again?', sender: 'other', timestamp: '10:07 AM' },
    ],
    '2': [
        { id: 'm4', text: 'The new update is awesome.', sender: 'other', timestamp: 'Yesterday' },
        { id: 'm5', text: 'I just got the Cyberpunk theme!', sender: 'other', timestamp: '1h ago' },
    ]
};

export default function MessagesPanel({ onClose, initialChatId }: MessagesPanelProps) {
    const [selectedChat, setSelectedChat] = useState<Conversation | null>(
        initialChatId ? (MOCK_CONVERSATIONS.find(c => c.id === initialChatId) || null) : null
    );
    const [messages, setMessages] = useState<Record<string, Message[]>>(MOCK_MESSAGES);
    const [inputValue, setInputValue] = useState('');
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [selectedChat, messages]);

    const handleSendMessage = () => {
        if (!inputValue.trim() || !selectedChat) return;

        const newMessage: Message = {
            id: Date.now().toString(),
            text: inputValue,
            sender: 'me',
            timestamp: 'Just now'
        };

        setMessages(prev => ({
            ...prev,
            [selectedChat.id]: [...(prev[selectedChat.id] || []), newMessage]
        }));
        setInputValue('');
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
                /* Unified global panel layout: top-64, bottom-80, bg-20 glass */
                className="fixed top-[64px] bottom-[80px] left-1/2 -translate-x-1/2 w-[calc(100%-32px)] max-w-[468px] bg-[#1a1c29]/20 backdrop-blur-xl border border-white/10 rounded-[32px] z-[110] flex flex-col shadow-2xl overflow-hidden"
            >
                {/* Handle Bar */}
                <div className="w-full flex justify-center pt-4 pb-2" onClick={onClose}>
                    <div className="w-12 h-1.5 bg-white/20 rounded-full" />
                </div>

                {/* Header */}
                <div className="px-panel-gutter pb-4 border-b border-white/10">
                    <div className="flex items-center justify-between mt-2">
                        <div className="flex items-center gap-2">
                            {selectedChat ? (
                                <button
                                    onClick={() => setSelectedChat(null)}
                                    className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 text-white/70 hover:bg-white/10 transition-all"
                                >
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                                        <polyline points="15 18 9 12 15 6"></polyline>
                                    </svg>
                                </button>
                            ) : (
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6 text-indigo-400">
                                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                                </svg>
                            )}
                            <h2 className="text-2xl font-bold text-white">
                                {selectedChat ? selectedChat.name : 'Messages'}
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
                <div className="flex-1 overflow-hidden relative px-panel-gutter">
                    <AnimatePresence mode="wait">
                        {!selectedChat ? (
                            /* Chat List */
                            <motion.div
                                key="list"
                                initial={{ opacity: 0, x: -20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -20 }}
                                className="h-full overflow-y-auto py-4 space-y-2 custom-scrollbar"
                            >
                                {MOCK_CONVERSATIONS.map((chat) => (
                                    <button
                                        key={chat.id}
                                        onClick={() => setSelectedChat(chat)}
                                        className="w-full flex items-center gap-4 p-3 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/5 transition-all group"
                                    >
                                        <div className="relative w-12 h-12 rounded-full overflow-hidden bg-white/10 flex-shrink-0">
                                            <img src={`/avatars/${chat.avatar}.png`} alt={chat.name} className="w-full h-full object-cover" />
                                            <div className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-[#1a1c29] 
                                                ${chat.status === 'Online' ? 'bg-green-500' : chat.status === 'In Match' ? 'bg-orange-500' : 'bg-gray-500'}`}
                                            />
                                        </div>
                                        <div className="flex-1 text-left min-w-0">
                                            <div className="flex justify-between items-center mb-0.5">
                                                <span className="font-bold text-white truncate">{chat.name}</span>
                                                <span className="text-[10px] text-white/40">{chat.time}</span>
                                            </div>
                                            <p className={`text-sm truncate ${chat.unread ? 'text-white font-medium' : 'text-white/50'}`}>
                                                {chat.lastMessage}
                                            </p>
                                        </div>
                                        {chat.unread && (
                                            <div className="w-2 h-2 rounded-full bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)]" />
                                        )}
                                    </button>
                                ))}
                            </motion.div>
                        ) : (
                            /* Chat Detail */
                            <motion.div
                                key="detail"
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 20 }}
                                className="flex flex-col h-full"
                            >
                                <div
                                    ref={scrollRef}
                                    className="flex-1 overflow-y-auto px-4 py-4 space-y-4 custom-scrollbar"
                                >
                                    {(messages[selectedChat.id] || []).map((msg) => (
                                        <div
                                            key={msg.id}
                                            className={`flex flex-col ${msg.sender === 'me' ? 'items-end' : 'items-start'}`}
                                        >
                                            <div className={`max-w-[80%] p-3 rounded-2xl text-[15px] shadow-sm ${msg.sender === 'me'
                                                ? 'bg-indigo-600 text-white rounded-tr-none'
                                                : 'bg-white/10 text-white/90 rounded-tl-none border border-white/5'
                                                }`}>
                                                {msg.text}
                                            </div>
                                            <span className="text-[10px] text-white/30 mt-1 px-1">{msg.timestamp}</span>
                                        </div>
                                    ))}
                                </div>

                                {/* Input Area */}
                                <div className="p-4 border-t border-white/10 bg-black/20">
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            value={inputValue}
                                            onChange={(e) => setInputValue(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                                            placeholder="Type a message..."
                                            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-indigo-500/50 transition-colors"
                                        />
                                        <button
                                            onClick={handleSendMessage}
                                            disabled={!inputValue.trim()}
                                            className="w-12 h-12 flex items-center justify-center rounded-xl bg-indigo-600 text-white disabled:opacity-50 disabled:bg-white/10 transition-all hover:bg-indigo-500"
                                        >
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                                                <line x1="22" y1="2" x2="11" y2="13"></line>
                                                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                                            </svg>
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
