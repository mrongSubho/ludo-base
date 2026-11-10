'use client';

import React, { useState, useEffect, useRef } from 'react';
import { CyberSticker, CyberStickerId } from '../emotes/CyberStickers';

export interface CombatLogEvent {
  id: string;
  type: 'roll' | 'move' | 'capture' | 'power' | 'turn';
  message: string;
  time: number;
}

interface ChatMessage {
  id: string;
  text: string;
  sender: string;
  color?: string;
  audience?: 'all' | 'team';
  time: number;
}

interface CommandDeckRightWingProps {
  onSendChat?: (text: string, audience: 'all' | 'team') => void;
  onSendEmote?: (stickerId: string, glyph: string, assetUrl?: string) => void;
  playerCount?: string | number;
  isTeamMatch?: boolean;
  myColor?: string;
  combatEvents?: CombatLogEvent[];
  chatInputRef?: React.RefObject<HTMLInputElement | null>;
  externalRightWing?: React.ReactNode;
}

const CYBER_STICKERS: { id: CyberStickerId; label: string; glyph: string }[] = [
  { id: 'cyber-orb-glitch', label: 'Glitch', glyph: '⚡' },
  { id: 'cyber-orb-overheat', label: 'Overheat', glyph: '🔥' },
  { id: 'cyber-orb-laser-eyes', label: 'Laser', glyph: '💥' },
  { id: 'cyber-orb-smug', label: 'Smug', glyph: '😎' },
  { id: 'cyber-orb-bounce', label: 'Bounce', glyph: '✨' },
  { id: 'cyber-orb-blue-screen', label: 'Crash', glyph: '💻' },
  { id: 'cyber-orb-diamond', label: 'Diamond', glyph: '💎' },
  { id: 'cyber-orb-wave', label: 'Wave', glyph: '👋' },
];

const QUICK_PHRASES = [
  'Good luck! ⚡',
  'Defend home! 🛡️',
  'Attack red! 🎯',
  'Nice roll! 🎲',
  'Well played! 🤝',
  'Hurry up! ⏱️',
];

export default function CommandDeckRightWing({
  onSendChat,
  onSendEmote,
  playerCount = '4P',
  isTeamMatch = false,
  myColor = 'blue',
  combatEvents: externalCombatEvents,
  chatInputRef,
  externalRightWing,
}: CommandDeckRightWingProps) {
  const [activeTab, setActiveTab] = useState<'chat' | 'stickers' | 'log'>('chat');
  const [chatDraft, setChatDraft] = useState('');
  const [teamOnly, setTeamOnly] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [localEvents, setLocalEvents] = useState<CombatLogEvent[]>([
    { id: 'init', type: 'turn', message: 'Match engine ready', time: Date.now() },
  ]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Listen to live chat & emote custom events from TeamUpContext + Board
  useEffect(() => {
    const handleChat = (ev: Event) => {
      const detail = (ev as CustomEvent).detail;
      if (!detail?.text) return;
      const evTime = typeof detail.t === 'number' ? detail.t : Date.now();
      const sender = detail.color || 'Player';
      setMessages((prev) => {
        if (prev.some((m) => m.time === evTime && m.text === detail.text && m.sender === sender)) {
          return prev;
        }
        return [
          ...prev.slice(-40),
          {
            id: `${evTime}-${Math.random()}`,
            text: detail.text,
            sender,
            color: detail.color,
            audience: detail.audience || 'all',
            time: evTime,
          },
        ];
      });
    };

    const handleEmote = (ev: Event) => {
      const detail = (ev as CustomEvent).detail;
      if (!detail) return;
      const evTime = typeof detail.t === 'number' ? detail.t : Date.now();
      const actor = detail.color || 'Player';
      const msg = `${actor} reacted ${detail.customText || detail.emoteId || 'emote'}`;
      setLocalEvents((prev) => {
        if (prev.some((e) => e.time === evTime && e.message === msg)) return prev;
        return [
          ...prev.slice(-40),
          {
            id: `${evTime}-${Math.random()}`,
            type: 'power',
            message: msg,
            time: evTime,
          },
        ];
      });
    };

    window.addEventListener('ludo-chat', handleChat);
    window.addEventListener('ludo-emote', handleEmote);
    return () => {
      window.removeEventListener('ludo-chat', handleChat);
      window.removeEventListener('ludo-emote', handleEmote);
    };
  }, []);

  if (externalRightWing) {
    return (
      <aside className="command-deck-wing-right-spacer w-[340px] shrink-0 flex flex-col">
        {externalRightWing}
      </aside>
    );
  }

  const combatEvents = externalCombatEvents && externalCombatEvents.length > 0 ? externalCombatEvents : localEvents;

  const transmitChat = (text: string) => {
    const clean = text.trim();
    if (!clean) return;
    const audience = teamOnly ? 'team' : 'all';
    if (onSendChat) {
      onSendChat(clean, audience);
    } else {
      window.dispatchEvent(
        new CustomEvent('ludo-chat', {
          detail: { text: clean, color: myColor, audience, t: Date.now() },
        }),
      );
    }
  };

  const handleSendMessage = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!chatDraft.trim()) return;
    transmitChat(chatDraft);
    setChatDraft('');
  };

  const handleTriggerSticker = (sticker: typeof CYBER_STICKERS[0]) => {
    const assetUrl = `/emotes/cyber-orb/${sticker.id.replace('cyber-orb-', 'orb-')}.svg`;
    if (onSendEmote) {
      onSendEmote(sticker.id, sticker.glyph, assetUrl);
    } else {
      window.dispatchEvent(
        new CustomEvent('ludo-emote', {
          detail: { emoteId: sticker.id, assetUrl, customText: sticker.label, color: myColor, t: Date.now() },
        }),
      );
    }
  };

  return (
    <aside className="command-deck-wing-right">
      {/* Tab Navigation */}
      <div className="flex items-center justify-between border-b border-line-soft bg-surface-panel p-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setActiveTab('chat')}
            className={`px-3 py-1.5 rounded-lg text-ludo-xs uppercase tracking-wider font-bold transition-all cursor-pointer ${
              activeTab === 'chat'
                ? 'bg-accent text-surface-page shadow-sm'
                : 'text-ink-muted hover:text-ink-strong'
            }`}
          >
            Tactical Chat
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('stickers')}
            className={`px-3 py-1.5 rounded-lg text-ludo-xs uppercase tracking-wider font-bold transition-all cursor-pointer ${
              activeTab === 'stickers'
                ? 'bg-accent text-surface-page shadow-sm'
                : 'text-ink-muted hover:text-ink-strong'
            }`}
          >
            Stickers
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('log')}
            className={`px-3 py-1.5 rounded-lg text-ludo-xs uppercase tracking-wider font-bold transition-all cursor-pointer ${
              activeTab === 'log'
                ? 'bg-accent text-surface-page shadow-sm'
                : 'text-ink-muted hover:text-ink-strong'
            }`}
          >
            Log
          </button>
        </div>

        <span className="keycap-badge hidden sm:inline">C</span>
      </div>

      {/* Tab 1: Chat Stream */}
      {activeTab === 'chat' && (
        <div className="flex-1 flex flex-col justify-between overflow-hidden">
          <div className="flex-1 p-3 overflow-y-auto flex flex-col gap-2">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-4 text-ink-faint text-ludo-xs">
                <span>No transmissions yet.</span>
                <span className="text-ink-muted mt-1">Send a quick ping to coordinate moves!</span>
              </div>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className="p-2 rounded-xl bg-surface-recessed border border-line-soft text-ludo-xs flex flex-col gap-0.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold uppercase tracking-wider text-accent font-mono">
                      {m.sender}
                    </span>
                    {m.audience === 'team' && (
                      <span className="px-1.5 py-0.2 rounded bg-surface-panel text-positive text-ludo-xs font-mono">
                        TEAM ONLY
                      </span>
                    )}
                  </div>
                  <span className="text-ink-strong leading-relaxed">{m.text}</span>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Phrases */}
          <div className="p-2 border-t border-line-soft bg-surface-panel/50 flex flex-wrap gap-1">
            {QUICK_PHRASES.map((phrase, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => transmitChat(phrase)}
                className="px-2 py-1 rounded-md bg-surface-recessed hover:bg-surface-hover border border-line-soft text-ludo-xs text-ink-muted hover:text-ink-strong transition-all cursor-pointer"
              >
                {phrase}
              </button>
            ))}
          </div>

          {/* Chat Composer Form */}
          <form onSubmit={handleSendMessage} className="p-2.5 border-t border-line-soft bg-surface-panel flex flex-col gap-2">
            {(isTeamMatch || playerCount === '2v2') && (
              <div className="flex items-center justify-between text-ludo-xs font-mono">
                <span className="text-ink-muted">AUDIENCE:</span>
                <button
                  type="button"
                  onClick={() => setTeamOnly((prev) => !prev)}
                  className={`px-2 py-0.5 rounded border transition-all cursor-pointer ${
                    teamOnly
                      ? 'bg-positive/20 text-positive border-positive/50'
                      : 'bg-surface-recessed text-ink-muted border-line-soft'
                  }`}
                >
                  {teamOnly ? 'TEAM ALLY ONLY' : 'ALL PLAYERS'}
                </button>
              </div>
            )}

            <div className="flex items-center gap-1.5">
              <input
                ref={chatInputRef}
                type="text"
                value={chatDraft}
                onChange={(e) => setChatDraft(e.target.value)}
                placeholder="TRANSMIT COMMS…"
                maxLength={100}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                className="flex-1 bg-surface-recessed px-3 py-2 rounded-xl text-ludo-xs text-ink-strong placeholder:text-ink-faint font-mono border border-line-soft focus:outline-none focus:border-accent"
              />
              <button
                type="submit"
                disabled={!chatDraft.trim()}
                className="px-3.5 py-2 rounded-xl text-ludo-xs uppercase tracking-wider font-bold bg-accent text-surface-page hover:brightness-110 active:scale-95 transition-all disabled:opacity-40 cursor-pointer"
              >
                SEND
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Tab 2: Stickers & Emotes Grid */}
      {activeTab === 'stickers' && (
        <div className="flex-1 p-3 overflow-y-auto flex flex-col gap-3">
          <span className="text-ludo-xs font-bold uppercase tracking-wider text-ink-strong font-mono">
            CYBER-ORB STICKERS 3077
          </span>

          <div className="grid grid-cols-4 gap-2">
            {CYBER_STICKERS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => handleTriggerSticker(s)}
                className="p-2 rounded-xl bg-surface-recessed hover:bg-surface-hover border border-line-soft hover:border-accent flex flex-col items-center justify-center gap-1 transition-all cursor-pointer group"
                title={s.label}
              >
                <CyberSticker id={s.id} size={42} className="group-hover:scale-110 transition-transform" />
                <span className="text-ludo-xs text-ink-faint font-mono truncate w-full text-center">
                  {s.label}
                </span>
              </button>
            ))}
          </div>

          <div className="pt-2 border-t border-line-soft">
            <span className="text-ludo-xs font-mono text-ink-faint">
              Clicking transmits instant reaction to arena Realtime channel.
            </span>
          </div>
        </div>
      )}

      {/* Tab 3: Combat Log */}
      {activeTab === 'log' && (
        <div className="flex-1 p-3 overflow-y-auto flex flex-col gap-2 font-mono text-ludo-xs">
          {combatEvents.map((ev) => (
            <div
              key={ev.id}
              className="p-2 rounded-lg bg-surface-recessed border border-line-soft flex items-start gap-2"
            >
              <span className="text-accent">•</span>
              <span className="text-ink-muted leading-relaxed">{ev.message}</span>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
