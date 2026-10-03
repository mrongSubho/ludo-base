/* eslint-disable @typescript-eslint/no-explicit-any -- lint burn-down quarantine 2026-09-23 */
import React, { useState, useEffect, useRef } from 'react';
import { motion, useMotionValue, animate, useTransform } from 'framer-motion';
import Leaderboard from './Leaderboard';
import PlayerProfileSheet from './PlayerProfileSheet';
import { PlayerColor, PowerType, PowerItem } from '@/lib/types';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import {
    assignCorners2v2, assignCornersFFA,
    buildPathCellsDynamic,
    shufflePlayers, ColorCorner, CORNER_SLOTS
} from '@/lib/boardLayout';
import { useGameEngine, Player } from '@/hooks/useGameEngine';
import { useTeamUp } from '@/hooks/useTeamUp';
import { useElementSize } from '@/hooks/useElementSize';

// Modular Components
import { HomeBlock } from './BoardHome';
import { BoardTokens } from './BoardTokens';
import { BoardGrid } from './BoardGrid';
import {
    IdleWarningOverlay,
    NameOverlay
} from './BoardOverlays';
import { MatchStatsOverlay } from './MatchStatsOverlay';
import { usePoolClaim } from '@/hooks/useChipsPool';
import { EmoteTray, parseEmotePayload } from './EmoteTray';
import { EmojiPickerPopover } from './EmojiPicker';
import type { EmoteEvent } from '@/lib/emotes';
import type { ChatEvent } from '@/lib/chat';
import { parseChatPayload, clampChatText, chatTtlMs } from '@/lib/chat';
import { EMOTE_TTL_MS } from '@/lib/emotes';
import type { GameActionPayload } from '@/lib/types';
import { getHopSamples } from '@/lib/perf/budget';
import { installPerfDebugHook } from '@/lib/perf/report';
import { PlayerRow, getDisplayNameHelper } from './PlayerInfoRow';

// Modular Hooks
import { useBoardLayout } from '@/hooks/useBoardLayout';

export default function Board({
    showLeaderboard = false,
    onToggleLeaderboard,
    playerCount = '4P',
    gameMode = 'classic',
    isBotMatch = false,
    onOpenProfile,
    initialPlayers,
    initialColorCorner,
    spectatorMode = false,
    externalGameState,
    wager = 0,
    poolId = null,
    botDifficulty = 'pro',
    onExitMatch,
    onOpenChat: _onOpenChat,
}: {
    showLeaderboard?: boolean;
    onToggleLeaderboard?: (show: boolean) => void;
    playerCount?: '1v1' | '4P' | '2v2';
    gameMode?: 'classic' | 'power' | 'snakes';
    isBotMatch?: boolean;
    onOpenProfile?: (address: string) => void;
    initialPlayers?: Player[];
    initialColorCorner?: ColorCorner;
    spectatorMode?: boolean;
    externalGameState?: import('@/lib/types').GameState;
    wager?: number;
    /** MatchPool id for paid online matches (CHIPS claim). */
    poolId?: `0x${string}` | null;
    botDifficulty?: import('@/lib/types').BotDifficulty;
    onExitMatch?: () => void;
    /** Open in-match chat / messages. */
    onOpenChat?: () => void;
}) {
    // Effective identity (wallet or guest id) so guests resolve as human.
    const { address } = useCurrentUser();
    const { participants, broadcastAction } = useTeamUp();
    const {
        claim: claimChips,
        claimable: onchainClaimable,
        isPending: claimBusy,
        error: claimError,
        configured: claimConfigured,
        secondsLeft,
    } = usePoolClaim(poolId);
    const [emoteFloats, setEmoteFloats] = React.useState<EmoteEvent[]>([]);
    // In-match lobby chat: compact composer + seat bubbles
    const [chatOpen, setChatOpen] = React.useState(false);
    const [chatDraft, setChatDraft] = React.useState('');
    const [chatEmojiOpen, setChatEmojiOpen] = React.useState(false);
    const [teamChatOnly, setTeamChatOnly] = React.useState(false);
    const [chatBubbles, setChatBubbles] = React.useState<ChatEvent[]>([]);

    // Q2 device-pass hook on the live board: `await __ludoPerf.markdown()`
    React.useEffect(() => {
        installPerfDebugHook(getHopSamples);
    }, []);

    React.useEffect(() => {
        const onEmote = (ev: Event) => {
            const parsed = parseEmotePayload((ev as CustomEvent).detail);
            if (!parsed) return;
            setEmoteFloats((f) => [...f.slice(-4), parsed]);
        };
        window.addEventListener('ludo-emote', onEmote);
        return () => window.removeEventListener('ludo-emote', onEmote);
    }, []);

    React.useEffect(() => {
        const onChat = (ev: Event) => {
            const parsed = parseChatPayload((ev as CustomEvent).detail);
            if (!parsed) return;
            setChatBubbles((b) => [...b.slice(-3), parsed]);
        };
        window.addEventListener('ludo-chat', onChat);
        return () => window.removeEventListener('ludo-chat', onChat);
    }, []);

    // Expire bubbles after TTL (same cadence as emote floats)
    React.useEffect(() => {
        if (chatBubbles.length === 0) return;
        const expiresAt = Math.min(...chatBubbles.map((bubble) => bubble.t + chatTtlMs(bubble.text)));
        const t = window.setTimeout(() => {
            setChatBubbles((b) => b.filter((x) => Date.now() - x.t < chatTtlMs(x.text)));
        }, Math.max(0, expiresAt - Date.now()));
        return () => window.clearTimeout(t);
    }, [chatBubbles]);

    React.useEffect(() => {
        if (emoteFloats.length === 0) return;
        const t = window.setTimeout(() => {
            setEmoteFloats((f) => f.filter((x) => Date.now() - x.t < EMOTE_TTL_MS));
        }, EMOTE_TTL_MS);
        return () => window.clearTimeout(t);
    }, [emoteFloats]);

    const [boardConfig, setBoardConfig] = useState(() => {
        if (initialPlayers && initialColorCorner) {
            return {
                players: initialPlayers,
                colorCorner: initialColorCorner
            };
        }
        const cc = playerCount === '2v2' ? assignCorners2v2() : assignCornersFFA(playerCount as '1v1' | '4P');
        const generatedPlayers = shufflePlayers(playerCount, isBotMatch, cc) as Player[];
        return {
            players: generatedPlayers,
            colorCorner: cc
        };
    });

    useEffect(() => {
        if (initialPlayers && initialColorCorner) {
            setBoardConfig({
                players: initialPlayers,
                colorCorner: initialColorCorner
            });
        }
    }, [initialPlayers, initialColorCorner]);

    const { players, colorCorner } = boardConfig;
    const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
    const [isShaking, setIsShaking] = useState(false);

    const pathCells = React.useMemo(() => buildPathCellsDynamic(colorCorner), [colorCorner]);

    const engine = useGameEngine({
        initialPlayers: players,
        playerCount,
        gameMode,
        isBotMatch,
        botDifficulty,
        colorCorner,
        pathCells,
        setBoardConfig,
        wager
    });

    const localGameState = (spectatorMode && externalGameState) ? externalGameState : engine.gameState;
    const { handleRoll, handleTokenClick, handleUsePower, resetGame, cancelAfk, lxpGain } = engine;
    // Powers execute host-side (guests replay broadcast state); only the
    // authority seat gets the inventory to avoid local-only desync spends.
    const canUsePowers = (engine as any).isAuthority !== false;

    // ─── Power inventory + targeting ─────────────────────────────────────
    // Bottom-centered badge bar for the human turn player's live powers.
    // Nuke/teleport arm targeting (gold rings on that color's tokens);
    // shield/boost fire immediately. One power per roll, enforced engine-side.
    const [targeting, setTargeting] = useState<{ type: PowerType } | null>(null);

    const { boardRotationDeg, counterRotationDeg, uiSlots } = useBoardLayout({
        players,
        colorCorner,
        address,
        participants,
        setBoardConfig
    });

    // Capture Shake
    useEffect(() => {
        if (localGameState.captureMessage?.includes('Captured') || localGameState.captureMessage?.includes('BOMB')) {
            setIsShaking(true);
            const timer = setTimeout(() => setIsShaking(false), 500);
            return () => clearTimeout(timer);
        }
    }, [localGameState.captureMessage]);

    // Timer Animation Logic
    const smoothProgress = useMotionValue(localGameState.timeLeft / 15);
    const prevPlayerRef = useRef(localGameState.currentPlayer);

    useEffect(() => {
        if (prevPlayerRef.current !== localGameState.currentPlayer) {
            smoothProgress.set(1);
            prevPlayerRef.current = localGameState.currentPlayer;
        }
        animate(smoothProgress, localGameState.timeLeft / 15, { duration: 1, ease: "linear" });
    }, [localGameState.timeLeft, localGameState.currentPlayer, smoothProgress]);

    const activeColor = {
        green: 'var(--ludo-green)', 
        red: 'var(--ludo-red)', 
        blue: 'var(--ludo-blue)', 
        yellow: 'var(--ludo-yellow)'
    }[localGameState.currentPlayer] || 'var(--ludo-muted)';

    const myPlayer = players.find(p => address && p.walletAddress?.toLowerCase() === address.toLowerCase()) || players.find(p => !p.isAi);

    // ─── Power inventory: own eyes only (+ targeting) ────────────────────
    // You see your inventory, never opponents'. (Teammate view is a future
    // patch.) Spendable on your own rolling turn; one power per roll.
    // Measured board sizing: the grid fills the real board-area box —
    // no viewport arithmetic, correct on every screen by construction.
    const [areaRef, areaSize] = useElementSize<HTMLDivElement>();
    const boardSquarePx = areaSize.w > 0 && areaSize.h > 0
        ? Math.max(160, Math.floor(Math.min(areaSize.w, areaSize.h)))
        : undefined;
    const turnColor = localGameState.currentPlayer as PlayerColor;
    const ownColor = myPlayer?.color;
    const sendChat = React.useCallback(() => {
        const text = clampChatText(chatDraft);
        if (!text || !ownColor) return;
        const ev: ChatEvent = { text, color: ownColor, audience: teamChatOnly ? 'team' : 'all', t: Date.now() };
        setChatBubbles((b) => [...b.slice(-3), ev]);
        broadcastAction('CHAT', {
            text,
            color: ownColor,
            audience: teamChatOnly ? 'team' : 'all',
            t: ev.t,
        } as GameActionPayload<'CHAT'>);
        setChatDraft('');
        setChatOpen(false);
    }, [chatDraft, ownColor, teamChatOnly, broadcastAction]);
    const isMyTurn = !!ownColor && turnColor === ownColor;
    const showInventory = !spectatorMode && !!ownColor && canUsePowers;
    const liveInventory: PowerItem[] = showInventory
        ? ((localGameState.playerPowers?.[ownColor!] || []).filter((p: PowerItem) => p.expiresAt > Date.now()))
        : [];
    // Always list every power type (0-count orbs stay visible — game inventory bar).
    const groupedInventory = (['boost', 'shield', 'teleport', 'nuke'] as PowerType[])
        .map(t => {
            const items = liveInventory.filter(p => p.type === t);
            return {
                type: t,
                count: items.length,
                soonest: items.length ? Math.min(...items.map(p => p.expiresAt)) : 0,
            };
        });
    const canSpend = showInventory && isMyTurn && localGameState.gamePhase === 'rolling' && !localGameState.powerSpentThisTurn;
    useEffect(() => {
        setTargeting(null);
    }, [localGameState.currentPlayer, localGameState.gamePhase]);
    const spendPower = (type: PowerType) => {
        if (!canSpend || !ownColor) return;
        if (type === 'nuke' || type === 'teleport') {
            setTargeting(cur => (cur?.type === type ? null : { type }));
            return;
        }
        setTargeting(null);
        handleUsePower(ownColor, type);
    };
    const spendTargeted = (color: PlayerColor, idx: number) => {
        if (targeting && ownColor && color === ownColor) {
            handleUsePower(ownColor, targeting.type, idx);
        }
        setTargeting(null);
    };

    return (
        <div data-theme="default" className="board-outer board-match-theme-wrapper w-full h-full">
            <PlayerRow
                corners={['TL', 'TR']}
                uiSlots={uiSlots}
                players={players}
                localGameState={localGameState}
                handleRoll={handleRoll}
                spectatorMode={spectatorMode}
                myPlayerColor={myPlayer?.color}
            />

            <motion.div 
                className="board-area"
                ref={areaRef} 
                animate={isShaking ? { x: [-2, 2, -2, 2, 0] } : {}}
                transition={{ duration: 0.4 }}
                style={{ position: 'relative', width: '100%', cursor: 'pointer' }}
                onClick={() => {
                    if (myPlayer?.color && localGameState.afkStats?.[myPlayer.color]?.isAutoPlaying) {
                        cancelAfk(myPlayer.color);
                    }
                }}
            >
                <div
                    className="board-wrapper"
                    style={{
                        position: 'relative',
                        transform: boardRotationDeg !== 0 ? `rotate(${boardRotationDeg}deg)` : undefined,
                        transition: 'transform 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
                    }}
                >
                    <BoardGrid
                        squarePx={boardSquarePx}
                        pathCells={pathCells}
                        colorCorner={colorCorner}
                        localGameState={localGameState}
                        activeColor={activeColor}
                        sweepProgress={smoothProgress}
                        pointRotation={useBoardLayoutRotation(smoothProgress)}
                        counterRotationDeg={counterRotationDeg}
                    >
                        {(['green', 'red', 'yellow', 'blue'] as const).map((color) => {
                            const isActivePlayer = players.some(p => p.color === color);
                            // Inactive corners have no player — show empty base (placeholder dots only)
                            const tokensInHome = isActivePlayer
                                ? localGameState.positions[color].map((pos: number, idx: number) => Number(pos) === -1 ? idx : -1).filter((idx: number) => idx !== -1)
                                : [];
                            const finishedTokens = isActivePlayer
                                ? localGameState.positions[color].map((pos: number, idx: number) => Number(pos) === 57 ? idx : -1).filter((idx: number) => idx !== -1)
                                : [];
                            const positions = localGameState.positions?.[color] as number[] | undefined;
                            return (
                                <HomeBlock
                                    key={color}
                                    color={color}
                                    corner={colorCorner[color]}
                                    gridRow={CORNER_SLOTS[colorCorner[color]].gridRow}
                                    gridCol={CORNER_SLOTS[colorCorner[color]].gridCol}
                                    tokensInHome={tokensInHome}
                                    finishedTokens={finishedTokens}
                                    positions={positions}
                                    colorCorner={colorCorner}
                                    viewerColor={uiSlots.BL ?? undefined}
                                    onTokenClick={(idx) => handleTokenClick(color, idx)}
                                    isDraggable={isActivePlayer && localGameState.currentPlayer === color && localGameState.gamePhase === 'moving' && Number(localGameState.diceValue) === 6}
                                    counterRotationDeg={counterRotationDeg}
                                    diceValue={localGameState.diceValue}
                                    gamePhase={localGameState.gamePhase}
                                    currentPlayer={localGameState.currentPlayer}
                                />
                            );
                        })}
                <BoardTokens
                    players={players}
                    localGameState={localGameState}
                    colorCorner={colorCorner}
                    address={address}
                    playerCount={playerCount}
                    handleTokenClick={handleTokenClick}
                    counterRotationDeg={counterRotationDeg}
                    targetingColor={targeting ? ownColor ?? null : null}
                    onTargetToken={spendTargeted}
                />
            </BoardGrid>

            {/* Name pills sit on the board square (not board-area padding). */}
            <NameOverlay
                uiSlots={uiSlots}
                players={players}
                getDisplayName={getDisplayNameHelper}
                counterRotationDeg={counterRotationDeg}
                chatBubbles={chatBubbles}
                emoteFloats={emoteFloats}
                viewerColor={ownColor}
                playerCount={playerCount}
            />

            {lxpGain !== null && (
                <motion.div
                    initial={{ opacity: 0, y: 20, scale: 0.8 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -20, scale: 0.8 }}
                    className="absolute top-16 left-1/2 -translate-x-1/2 z-[50] px-4 py-2 bg-black/80 backdrop-blur-md border border-cyan-500/40 rounded-full shadow-[0_0_20px_rgba(34,211,238,0.3)] flex items-center gap-2"
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                    <span className="text-sm font-black text-amber-400">+{lxpGain} XP</span>
                </motion.div>
            )}

              </div>

             <IdleWarningOverlay idleWarning={localGameState.idleWarning} myPlayer={myPlayer} onCancelAfk={cancelAfk} />
         </motion.div>

            <MatchStatsOverlay
                open={!!localGameState.winner && !spectatorMode}
                gameState={localGameState}
                players={players}
                myPlayer={myPlayer}
                playerCount={playerCount}
                wager={wager}
                gameMode={gameMode}
                lxpGain={lxpGain}
                onRematch={resetGame}
                onExit={onExitMatch}
                poolId={claimConfigured ? poolId : null}
                onClaimChips={claimConfigured ? () => void claimChips() : undefined}
                claimableChips={
                    onchainClaimable != null ? Number(onchainClaimable) / 1e18 : undefined
                }
                claimBusy={claimBusy}
                claimError={claimError}
                claimUnlocksInMin={secondsLeft > 0 ? Math.ceil(secondsLeft / 60) : undefined}
                isPoolHost={claimConfigured}
                poolAuthority={(address as `0x${string}` | undefined) ?? null}
                winnerAddress={
                    myPlayer?.color &&
                    (localGameState.winner === myPlayer.color ||
                        (localGameState.winners ?? []).includes(myPlayer.color))
                        ? ((address as `0x${string}` | undefined) ?? null)
                        : null
                }
            />

            <PlayerRow
                corners={['BL', 'BR']}
                uiSlots={uiSlots}
                players={players}
                localGameState={localGameState}
                handleRoll={handleRoll}
                spectatorMode={spectatorMode}
                myPlayerColor={myPlayer?.color}
            />

            {/* Match footer: Emotes (left) · Power orbs (center) · Chat (right) */}
            <div className={`match-footer ${chatOpen ? 'match-footer-chat' : ''}`}>
                {chatOpen ? (
                    <div className="match-chat-composer">
                        <div className="match-chat-composer-head">
                            <span className="chat-sheet-title">In-game chat</span>
                            <button
                                type="button"
                                className={`team-chat-toggle ${teamChatOnly ? 'on' : ''}`}
                                onClick={() => setTeamChatOnly((value) => !value)}
                                disabled={playerCount !== '2v2'}
                                aria-pressed={teamChatOnly}
                            >
                                {teamChatOnly ? 'Team only' : 'Everyone'}
                            </button>
                            <button type="button" className="chat-sheet-x" onClick={() => setChatOpen(false)} aria-label="Close chat">×</button>
                        </div>
                        <div className="match-chat-composer-row">
                            <textarea
                                className="chat-composer-input"
                                value={chatDraft}
                                maxLength={80}
                                rows={1}
                                placeholder={teamChatOnly ? 'Message your teammate…' : 'Message everyone…'}
                                autoComplete="off"
                                autoCorrect="off"
                                autoCapitalize="sentences"
                                spellCheck={false}
                                enterKeyHint="send"
                                autoFocus
                                onChange={(e) => setChatDraft(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        sendChat();
                                    }
                                    if (e.key === 'Escape') setChatOpen(false);
                                }}
                            />
                            <EmojiPickerPopover
                                open={chatEmojiOpen}
                                onToggle={() => setChatEmojiOpen((value) => !value)}
                                onSelect={(emote) => {
                                    setChatDraft((draft) => `${draft}${emote.glyph}`.slice(0, 80));
                                    setChatEmojiOpen(false);
                                }}
                                label="Add emoji"
                            />
                            <button type="button" className="chat-composer-send" onClick={sendChat} disabled={!chatDraft.trim()}>Send</button>
                        </div>
                    </div>
                ) : (
                <>
                <div className="match-footer-slot left">
                    {!spectatorMode && myPlayer && (
                        <EmoteTray
                                    myColor={myPlayer.color}
                                    onEmote={(event) => {
                                setEmoteFloats((f) => [...f.slice(-4), event]);
                                broadcastAction('EMOTE', {
                                    emoteId: event.emoteId,
                                    color: event.color,
                                    actor: event.actor,
                                    customText: event.customText,
                                    assetUrl: event.assetUrl,
                                    t: event.t,
                                } as GameActionPayload<'EMOTE'>);
                            }}
                        />
                    )}
                </div>
                <div className="match-footer-slot center">
                    {showInventory && (
                        <div className="power-inv-strip">
                            {targeting && <span className="power-inv-hint">Tap a token</span>}
                            {groupedInventory.map(g => {
                                const has = g.count > 0;
                                return (
                                    <button
                                        key={g.type}
                                        onClick={() => spendPower(g.type)}
                                        disabled={!canSpend || !has}
                                        aria-label={`Use ${g.type} power, ${g.count} held`}
                                        className={`power-orb power-orb-${g.type} ${targeting?.type === g.type ? 'power-orb-armed' : ''} ${has ? '' : 'power-orb-empty'}`}
                                    >
                                        <PowerGlyph type={g.type} />
                                        <span className={`power-orb-count ${has ? '' : 'zero'}`}>{g.count}</span>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
                <div className="match-footer-slot right">
                    <button
                        type="button"
                        className={`match-foot-pill ${chatOpen ? 'on' : ''}`}
                        onClick={() => setChatOpen((v) => !v)}
                        aria-label="Chat"
                        aria-expanded={chatOpen}
                    >
                        Chat
                    </button>
                </div>
                </>
                )}
            </div>

            <Leaderboard isOpen={showLeaderboard} onClose={() => onToggleLeaderboard?.(false)} onOpenProfile={onOpenProfile || (() => { })} />
            {selectedPlayer && (
                <PlayerProfileSheet
                    player={selectedPlayer}
                    wins={localGameState.positions[selectedPlayer.color].filter((p: number) => p === 57).length}
                    onClose={() => setSelectedPlayer(null)}
                />
            )}
        </div>
    );
}

// Helper for the timer translation
function useBoardLayoutRotation(smoothProgress: any) {
    return useTransform(smoothProgress, [0, 1], [270, -90]);
}

// Power glyphs — match-footprint size (ref row).
function PowerGlyph({ type }: { type: PowerType }) {
    const cls = 'w-5 h-5 sm:w-6 sm:h-6';
    if (type === 'shield') {
        return (
            <svg viewBox="0 0 24 24" fill="none" stroke="#67e8f9" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={cls}>
                <path d="M12 2l8 3v6c0 5-3.5 9.5-8 11-4.5-1.5-8-6-8-11V5l8-3z" />
            </svg>
        );
    }
    if (type === 'boost') {
        return (
            <svg viewBox="0 0 24 24" fill="#facc15" className={cls}>
                <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
            </svg>
        );
    }
    if (type === 'nuke') {
        return (
            <svg viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2.2" className={cls}>
                <circle cx="12" cy="12" r="8" />
                <circle cx="12" cy="12" r="2.5" fill="#f87171" />
            </svg>
        );
    }
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="#c4b5fd" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={cls}>
            <path d="M4 12a8 8 0 0 1 14-5l2 2" />
            <path d="M20 4v5h-5" />
            <path d="M20 12a8 8 0 0 1-14 5l-2-2" />
            <path d="M4 20v-5h5" />
        </svg>
    );
}
