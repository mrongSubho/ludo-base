'use client';

import React, { useState, useEffect, useRef } from 'react';
import { CyberSticker, CyberStickerId } from '../emotes/CyberStickers';

interface ChatMessage {
  id: string;
  text: string;
  sender: string;
  color?: string;
  audience?: 'all' | 'team';
  time: number;
}

interface CombatLogEvent {
  id: string;
  type: 'roll' | 'move' | 'capture' | 'power' | 'turn';
  message: string;
  time: number;
}

interface CommandDeckRightWingProps {
  onSendChat?: (text: string, audience: 'all' | 'team') => void;
  onSendEmote?: (glyph: string, assetUrl?: string) => void;
  playerCount?: string | number;
  isTeamMatch?: boolean;
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
}: CommandDeckRightWingProps) {
  const [activeTab, setActiveTab] = useState<'chat' | 'stickers' | 'log'>('chat');
  const [chatDraft, setChatDraft] = useState('');
  const [teamOnly, setTeamOnly] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [combatEvents, setCombatEvents] = useState<CombatLogEvent[]>([
    { id: '1', type: 'turn', message: 'Match initialized on Base Sepolia', time: Date.now() - 30000 },
    { id: '2', type: 'roll', message: 'Engine CSPRNG dice verified', time: Date.now() - 25000 },
  ]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Listen to window chat and emote events
  useEffect(() => {
    const handleChat = (ev: Event) => {
      const detail = (ev as CustomEvent).detail;
      if (!detail?.text) return;
      setMessages((prev) => [
        ...prev.slice(-30),
        {
          id: `${Date.now()}-${Math.random()}`,
          text: detail.text,
          sender: detail.color || 'Player',
          color: detail.color,
          audience: detail.audience || 'all',
          time: Date.now(),
        },
      ]);
    };

    const handleEmote = (ev: Event) => {
      const detail = (ev as CustomEvent).detail;
      if (!detail) return;
      setCombatEvents((prev) => [
        ...prev.slice(-40),
        {
          id: `${Date.now()}-${Math.random()}`,
          type: 'power',
          message: `${detail.color || 'Player'} sent ${detail.glyph || 'emote'}`,
          time: Date.now(),
        },
      ]);
    };

    window.addEventListener('ludo-chat', handleChat);
    window.addEventListener('ludo-emote', handleEmote);
    return () => {
      window.removeEventListener('ludo-chat', handleChat);
      window.removeEventListener('ludo-emote', handleEmote);
    };
  }, []);

  const handleSendMessage = (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = chatDraft.trim();
    if (!text) return;

    if (onSendChat) {
      onSendChat(text, teamOnly ? 'team' : 'all');
    } else {
      window.dispatchEvent(
        new CustomEvent('ludo-chat', {
          detail: { text, color: 'blue', audience: teamOnly ? 'team' : 'all' },
        })
      );
    }

    setChatDraft('');
  };

  const handleSendQuickPhrase = (phrase: string) => {
    if (onSendChat) {
      onSendChat(phrase, teamOnly ? 'team' : 'all');
    } else {
      window.dispatchEvent(
        new CustomEvent('ludo-chat', {
          detail: { text: phrase, color: 'blue', audience: teamOnly ? 'team' : 'all' },
        })
      );
    }
  };

  const handleTriggerSticker = (sticker: typeof CYBER_STICKERS[0]) => {
    if (onSendEmote) {
      onSendEmote(sticker.glyph, `/emotes/cyber-orb/${sticker.id.replace('cyber-orb-', 'orb-')}.svg`);
    } else {
      window.dispatchEvent(
        new CustomEvent('ludo-emote', {
          detail: { glyph: sticker.glyph, color: 'blue' },
        })
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
            className={`px-3 py-1.5 rounded-lg text-ludo-xs uppercase tracking-wider font-bold transition-all ${
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
            className={`px-3 py-1.5 rounded-lg text-ludo-xs uppercase tracking-wider font-bold transition-all ${
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
            className={`px-3 py-1.5 rounded-lg text-ludo-xs uppercase tracking-wider font-bold transition-all ${
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
          {/* Messages List */}
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
                onClick={() => handleSendQuickPhrase(phrase)}
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
                  className={`px-2 py-0.5 rounded border transition-all ${
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
