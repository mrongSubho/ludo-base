/* eslint-disable @typescript-eslint/no-explicit-any -- lint burn-down quarantine 2026-09-23 */
import React, { useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion, useMotionValue, animate, useTransform } from 'framer-motion';
import { LuSend } from 'react-icons/lu';
import Leaderboard from './Leaderboard';
import PlayerProfileSheet from './PlayerProfileSheet';
import { PlayerColor, PowerType, PowerItem, type GameState } from '@/lib/types';
import { getTeammateColor } from '@/lib/gameLogic';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import {
    assignCornersForShape,
    buildPathCellsDynamic,
    shufflePlayers, ColorCorner, CORNER_SLOTS
} from '@/lib/boardLayout';
import { useGameEngine, Player } from '@/hooks/useGameEngine';
import { useTeamUp } from '@/hooks/useTeamUp';
import { useElementSize } from '@/hooks/useElementSize';
import { useStableBoardBox } from '@/hooks/useStableBoardBox';
import { usePresentedGameState } from '@/hooks/usePresentedGameState';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { usePreferences } from '@/hooks/usePreferences';
import { resolveDiceThemeId } from '@/lib/diceVisuals';

// Modular Components
import { HomeBlock } from './BoardHome';
import { BoardTokens, type BoardTransitStatus } from './BoardTokens';
import { BoardGrid } from './BoardGrid';
import {
    AfkReclaimBar,
    KickedAlertModal,
    NameOverlay,
} from './BoardOverlays';
import { isSeatInTier1Afk, isSeatPermanentlyLocked } from '@/lib/afkPolicy';
import { useClientPresence } from '@/hooks/useClientPresence';
import { ChatIcon, SimBotIcon } from './icons';
import { MatchStatsOverlay, type RematchOverlayState } from './MatchStatsOverlay';
import { TerminalTypeText } from './TerminalTypeText';
import {
    deriveMatchFeedEvent,
    formatPrimaryTurnLine,
    type CombatFeedLine,
    type PrimaryTurnLine,
} from '@/lib/matchFeed';
import { derivePowerVfxEvents, type PowerVfxEvent } from '@/lib/powerVfx';
import {
    resolveDisplayedTurnRolls,
    updateTurnRollHistory,
    type TurnRollHistoryState,
} from '@/lib/diceVisuals';
import {
    computeMovePreview,
    computeSingleLegalMovePreview,
    type MovePreviewTarget,
} from '@/lib/movePreview';
import { prefersReducedMotion } from '@/lib/motion';
import {
    REMATCH_TIMEOUT_MS,
    evaluateRematchOutcome,
    parseRematchPayload,
    type RematchVote,
} from '@/lib/rematch';
import { usePoolClaim } from '@/hooks/useChipsPool';
import { EmoteTray, parseEmotePayload } from './EmoteTray';
import { PowerInventoryDock } from './PowerInventoryDock';
import { EmojiPickerPopover } from './EmojiPicker';
import { RichChatField } from './RichChatField';
import { encodeChatDraft, insertDraftEmote, retainChatDraftEmotes, type ChatDraftEmote } from '@/lib/emotes';
import { BoardProjectileLayer } from './BoardProjectileLayer';
import {
    createProjectileEvent,
    parseProjectilePayload,
    PROJECTILE_TTL_MS,
    type EmoteEvent,
    type ProjectileEvent,
    type ProjectileId,
} from '@/lib/emotes';
import type { ChatEvent } from '@/lib/chat';
import { parseChatPayload, clampChatText, chatTtlMs } from '@/lib/chat';
import { EMOTE_TTL_MS } from '@/lib/emotes';
import { getHopSamples } from '@/lib/perf/budget';
import { installPerfDebugHook } from '@/lib/perf/report';
import { PlayerRow, getDisplayNameHelper } from './PlayerInfoRow';

// Modular Hooks
import { useBoardLayout } from '@/hooks/useBoardLayout';
import { useBoardAudio } from '@/hooks/useBoardAudio';
import { getSoundEngine } from '@/lib/audio/SoundEngine';
import { computeTransitionLandingDelays, emoteSoundIdFor } from '@/lib/audio/boardAudioState';

export interface RematchResolutionPlan {
    action: 'rematch_all' | 'hybrid_quick_search' | 'solo_quick_search';
    gameMode: 'classic' | 'power' | 'quick';
    playerCount: '1v1' | '2v2' | '4P';
    wager: number;
    acceptedWallets: string[];
    slotsNeeded: number;
    proposalId: string;
    startedMatchId?: string;
}

export default function Board({
    showLeaderboard = false,
    onToggleLeaderboard,
    playerCount = '4P',
    gameMode = 'power',
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
    onInspectInLiveArena,
    onOpenChat: _onOpenChat,
    onRematchResolved,
}: {
    showLeaderboard?: boolean;
    onToggleLeaderboard?: (show: boolean) => void;
    playerCount?: '1v1' | '4P' | '2v2';
    gameMode?: 'classic' | 'power' | 'quick';
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
    /** Jump straight to Live Arena spectator view when a seat is permanently kicked. */
    onInspectInLiveArena?: () => void;
    /** Open in-match chat / messages. */
    onOpenChat?: () => void;
    /** Online post-match rematch vote resolved (all accepted or quick-search fallback). */
    onRematchResolved?: (plan: RematchResolutionPlan) => void;
}) {
    // Effective identity (wallet or guest id) so guests resolve as human.
    const { address } = useCurrentUser();
    const { roomId, participants, broadcastSocial, serverSeq, roomStatus, matchConnectionStatus, retryRoom, roomResyncCount } = useTeamUp();
    const { preferences } = usePreferences();
    const themeId = resolveDiceThemeId(preferences?.theme);
    const reduced = useReducedMotion();
    const {
        claim: claimChips,
        claimable: onchainClaimable,
        isPending: claimBusy,
        error: claimError,
        configured: claimConfigured,
        secondsLeft,
    } = usePoolClaim(poolId);
    const [emoteFloats, setEmoteFloats] = React.useState<EmoteEvent[]>([]);
    const [projectiles, setProjectiles] = React.useState<ProjectileEvent[]>([]);
    // In-match lobby chat: compact composer + seat bubbles
    const [chatOpen, setChatOpen] = React.useState(false);
    const [chatDraft, setChatDraft] = React.useState('');
    const [chatDraftEmotes, setChatDraftEmotes] = React.useState<ChatDraftEmote[]>([]);
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
            getSoundEngine().play(emoteSoundIdFor(parsed.emoteId, parsed.assetUrl));
        };
        window.addEventListener('ludo-emote', onEmote);
        return () => window.removeEventListener('ludo-emote', onEmote);
    }, []);

    React.useEffect(() => {
        const onChat = (ev: Event) => {
            const parsed = parseChatPayload((ev as CustomEvent).detail);
            if (!parsed) return;
            setChatBubbles((b) => [...b.slice(-3), parsed]);
            getSoundEngine().play(parsed.audience === 'team' ? 'chat_team' : 'chat_all');
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

    React.useEffect(() => {
        const onProjectile = (ev: Event) => {
            const parsed = parseProjectilePayload((ev as CustomEvent).detail);
            if (!parsed) return;
            setProjectiles((prev) => [...prev.slice(-7), parsed]);
        };
        window.addEventListener('ludo-projectile', onProjectile);
        return () => window.removeEventListener('ludo-projectile', onProjectile);
    }, []);

    React.useEffect(() => {
        if (projectiles.length === 0) return;
        const t = window.setTimeout(() => {
            setProjectiles((prev) => prev.filter((p) => Date.now() - p.t < PROJECTILE_TTL_MS));
        }, PROJECTILE_TTL_MS);
        return () => window.clearTimeout(t);
    }, [projectiles]);

    const [boardConfig, setBoardConfig] = useState(() => {
        if (initialPlayers && initialColorCorner) {
            return {
                players: initialPlayers,
                colorCorner: initialColorCorner
            };
        }
        const cc = assignCornersForShape(playerCount as '1v1' | '2v2' | '4P');
        // MM-15: `shufflePlayers` is the OFFLINE seeding path — it invents a
        // random table. Reaching it in a networked match means the roster never
        // arrived, and the old code silently rendered that invented table: one
        // device showed the real players, the other showed random bots, and
        // neither could reconcile a turn. Say so instead of hiding it.
        console.warn(
            `🎲 [Board] no roster supplied — seeding a local table (isBotMatch=${isBotMatch}). ` +
            'In a networked match this means START_GAME arrived without initialBoardConfig.',
        );
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
    const [nukeShaking, setNukeShaking] = useState(false);
    const [feedEvent, setFeedEvent] = useState<CombatFeedLine | null>(null);
    const [powerVfxEvents, setPowerVfxEvents] = useState<PowerVfxEvent[]>([]);
    const [bustState, setBustState] = useState<{ color: PlayerColor; key: number } | null>(null);
    const [turnRollHistory, setTurnRollHistory] = useState<TurnRollHistoryState>(() => ({
        player: 'green',
        rolls: [],
        nextId: 0,
    }));
    const prevStateRef = useRef<GameState | null>(null);
    const feedSeqRef = useRef(0);
    const vfxSeqRef = useRef(0);
    const feedTimerRef = useRef<number | null>(null);
    const pendingTimeoutsRef = useRef<number[]>([]);

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

    const authoritativeGameState = (spectatorMode && externalGameState) ? externalGameState : engine.gameState;
    const { presentedState: localGameState, barrier: animationBarrier } = usePresentedGameState({
        authoritativeState: authoritativeGameState,
        colorCorner,
        themeId,
        resyncVersion: roomResyncCount,
    });
    const {
        handleRoll,
        handleTokenClick,
        handleUsePower,
        resetGame,
        cancelAfk,
        updateLocalPresence,
        sendRoomIntent,
        roomAuthority,
        getRoomServerNow,
        matchAuthorityMode,
        lxpGain,
    } = engine;

    // Sync board roster & corner mapping whenever authoritative online state delivers initialBoardConfig.
    useEffect(() => {
        if (isBotMatch) return;
        const authCfg = authoritativeGameState?.initialBoardConfig;
        if (!authCfg?.players?.length || !authCfg?.colorCorner) return;
        setBoardConfig((cur) => {
            const sameCorners =
                cur.colorCorner.green === authCfg.colorCorner.green &&
                cur.colorCorner.red === authCfg.colorCorner.red &&
                cur.colorCorner.yellow === authCfg.colorCorner.yellow &&
                cur.colorCorner.blue === authCfg.colorCorner.blue;
            const sameRoster =
                cur.players.length === authCfg.players.length &&
                cur.players.every(
                    (p, i) =>
                        p.color === authCfg.players[i]?.color &&
                        (p.walletAddress ?? '') === (authCfg.players[i]?.walletAddress ?? '') &&
                        Boolean(p.isAi) === Boolean(authCfg.players[i]?.isAi),
                );
            if (sameCorners && sameRoster) return cur;
            return {
                players: authCfg.players as Player[],
                colorCorner: authCfg.colorCorner,
            };
        });
    }, [isBotMatch, authoritativeGameState?.initialBoardConfig]);
    // Powers execute host/room-side (guests replay broadcast state); in Room DO mode
    // every seated player may trigger REQUEST_POWER from their server-held hand.
    const canUsePowers = matchAuthorityMode === 'room' || (engine as any).isAuthority !== false;

    // ─── Power inventory + targeting ─────────────────────────────────────
    // Bottom-centered badge bar for the human turn player's live powers.
    // Nuke/teleport arm targeting (gold rings on that color's tokens);
    // shield/boost fire immediately. One power per roll, enforced engine-side.
    const [targeting, setTargeting] = useState<{ type: PowerType } | null>(null);

    const { boardRotationDeg, counterRotationDeg, uiSlots } = useBoardLayout({
        players,
        colorCorner,
        address: spectatorMode ? undefined : address,
        participants,
        setBoardConfig
    });

    // Unified state-transition feed, power VFX, nuke detonation shake & triple-6 bust tracker.
    // Timers live in refs so routine 1s clock ticks never abort an active detonation or banner.
    useEffect(() => {
        return () => {
            if (feedTimerRef.current !== null) window.clearTimeout(feedTimerRef.current);
            pendingTimeoutsRef.current.forEach((id) => window.clearTimeout(id));
            pendingTimeoutsRef.current = [];
        };
    }, []);

    useEffect(() => {
        const prev = prevStateRef.current;
        prevStateRef.current = localGameState;
        if (!prev) return;

        setTurnRollHistory((cur) => updateTurnRollHistory(cur, prev, localGameState));

        const ownPlayerColor =
            (players.find((p) => address && p.walletAddress?.toLowerCase() === address.toLowerCase()) ||
                players.find((p) => !p.isAi))?.color;

        const nextFeed = deriveMatchFeedEvent(prev, localGameState, {
            myColor: ownPlayerColor,
            playerCount,
            colorCorner,
            spectatorMode,
        });
        if (nextFeed) {
            const nextId = ++feedSeqRef.current;
            setFeedEvent({ ...nextFeed, id: nextId });
            if (feedTimerRef.current !== null) window.clearTimeout(feedTimerRef.current);
            feedTimerRef.current = window.setTimeout(() => {
                setFeedEvent((cur) => (cur?.id === nextId ? null : cur));
            }, 4600);

            if (nextFeed.tone === 'capture' && !prefersReducedMotion()) {
                const captureDelay = computeTransitionLandingDelays(
                    prev,
                    localGameState,
                    colorCorner,
                    themeId,
                    false,
                ).captureDelayMs;
                const triggerShake = () => {
                    setIsShaking(true);
                    const t = window.setTimeout(() => setIsShaking(false), 480);
                    pendingTimeoutsRef.current.push(t);
                };
                if (captureDelay <= 0) {
                    triggerShake();
                } else {
                    const startT = window.setTimeout(triggerShake, captureDelay);
                    pendingTimeoutsRef.current.push(startT);
                }
            }
            if (nextFeed.tone === 'bust') {
                setBustState((cur) => ({ color: prev.currentPlayer, key: (cur?.key ?? 0) + 1 }));
            }
        }

        const vfxItems = derivePowerVfxEvents(prev, localGameState, colorCorner, playerCount);
        if (vfxItems.length > 0) {
            const stamped = vfxItems.map((item) => ({ ...item, id: ++vfxSeqRef.current }) as PowerVfxEvent);
            setPowerVfxEvents((cur) => [...cur, ...stamped]);
            stamped.forEach((ev) => {
                const ttl = ev.kind === 'nuke' ? 2500 : ev.kind === 'teleport' ? 1500 : 1200;
                const clearTimer = window.setTimeout(() => {
                    setPowerVfxEvents((cur) => cur.filter((x) => x.id !== ev.id));
                }, ttl);
                pendingTimeoutsRef.current.push(clearTimer);

                if (ev.kind === 'nuke' && !prefersReducedMotion()) {
                    const startShake = window.setTimeout(() => {
                        setNukeShaking(true);
                        const endShake = window.setTimeout(() => setNukeShaking(false), 540);
                        pendingTimeoutsRef.current.push(endShake);
                    }, 880);
                    pendingTimeoutsRef.current.push(startShake);
                }
            });
        }
    }, [localGameState, players, address, playerCount, colorCorner, spectatorMode, themeId]);

    // Timer Animation Logic
    const turnTotalSecs = Math.max(1, Math.round((localGameState.turnDurationMs ?? 15000) / 1000));
    const smoothProgress = useMotionValue(Math.min(1, Math.max(0, localGameState.timeLeft / turnTotalSecs)));
    const prevPhaseKeyRef = useRef(`${localGameState.currentPlayer}|${localGameState.turnPhaseKind ?? ''}|${turnTotalSecs}`);
    // REA-21: the rotation hook was called inline in the JSX props below
    // (`pointRotation={useBoardLayoutRotation(...)}`) — legal but fragile (a
    // conditional render path would break hook order) and re-created per
    // render. Hoisted to component scope like every other hook.
    const pointRotation = useBoardLayoutRotation(smoothProgress);

    useEffect(() => {
        const phaseKey = `${localGameState.currentPlayer}|${localGameState.turnPhaseKind ?? ''}|${turnTotalSecs}`;
        if (prevPhaseKeyRef.current !== phaseKey) {
            smoothProgress.set(Math.min(1, Math.max(0, localGameState.timeLeft / turnTotalSecs)));
            prevPhaseKeyRef.current = phaseKey;
        }
        animate(smoothProgress, Math.min(1, Math.max(0, localGameState.timeLeft / turnTotalSecs)), { duration: 1, ease: "linear" });
    }, [localGameState.timeLeft, localGameState.currentPlayer, localGameState.turnPhaseKind, turnTotalSecs, smoothProgress]);

    const activeColor = {
        green: 'var(--ludo-green)', 
        red: 'var(--ludo-red)', 
        blue: 'var(--ludo-blue)', 
        yellow: 'var(--ludo-yellow)'
    }[localGameState.currentPlayer] || 'var(--ludo-muted)';

    const baseMyPlayer = players.find(p => address && p.walletAddress?.toLowerCase() === address.toLowerCase()) || players.find(p => !p.isAi);
    const isPassAndPlay =
        !spectatorMode &&
        !isBotMatch &&
        matchAuthorityMode === 'offline' &&
        players.length > 1 &&
        players.every((p) => !p.isAi);
    const myPlayer = isPassAndPlay
        ? (players.find((p) => p.color === localGameState.currentPlayer) ?? baseMyPlayer)
        : baseMyPlayer;
    const isPresentationSynced =
        spectatorMode ||
        (localGameState.currentPlayer === authoritativeGameState.currentPlayer &&
            localGameState.gamePhase === authoritativeGameState.gamePhase &&
            (localGameState.diceValue ?? null) === (authoritativeGameState.diceValue ?? null) &&
            Boolean(localGameState.isRolling) === Boolean(authoritativeGameState.isRolling));
    const myAfk = myPlayer?.color ? localGameState.afkStats?.[myPlayer.color] : undefined;
    const isMeTier1Afk = Boolean(
        !spectatorMode &&
            !localGameState.winner &&
            !localGameState.abortReason &&
            myPlayer?.color &&
            isSeatInTier1Afk(myAfk),
    );
    const isMeKicked = Boolean(
        !spectatorMode &&
            !localGameState.winner &&
            !localGameState.abortReason &&
            myPlayer?.color &&
            isSeatPermanentlyLocked(myAfk),
    );

    useClientPresence({
        enabled: Boolean(
            !spectatorMode &&
                !localGameState.winner &&
                !localGameState.abortReason &&
                myPlayer?.color &&
                !isMeKicked,
        ),
        myColor: myPlayer?.color,
        matchAuthorityMode,
        roomAuthority,
        sendRoomIntent,
        onLocalPresenceChange: updateLocalPresence,
    });

    useBoardAudio({
        gameState: localGameState,
        players,
        myColor: myPlayer?.color,
        playerCount,
        colorCorner,
        spectatorMode,
    });

    // ─── Power inventory: own eyes only (+ targeting) ────────────────────
    // You see your inventory, never opponents'. (Teammate view is a future
    // patch.) Spendable on your own rolling turn; one power per roll.
    // ─── Board sizing: a COMMITTED value ──────────────────────────────────
    // The square re-commits only on a real layout change (rotation, window
    // resize, device) — see hooks/useStableBoardBox. Overlays (chat composer,
    // panels, emotes) and the IME/keyboard can never shrink it; they draw over
    // the board. The area box is pinned to the committed height too, so the
    // HUD cluster around it never reflows either.
    const [areaRef, areaSize] = useElementSize<HTMLDivElement>();
    const stableBox = useStableBoardBox(areaSize);
    const boardSquarePx = stableBox?.square;
    const turnColor = localGameState.currentPlayer as PlayerColor;
    const ownColor = myPlayer?.color;
    const sendChat = React.useCallback(() => {
        const text = clampChatText(encodeChatDraft(chatDraft, chatDraftEmotes));
        if (!text || !ownColor) return;
        const ev: ChatEvent = { text, color: ownColor, audience: teamChatOnly ? 'team' : 'all', t: Date.now() };
        setChatDraftEmotes([]);
        setChatBubbles((b) => [...b.slice(-3), ev]);
        broadcastSocial('CHAT', {
            text,
            color: ownColor,
            audience: teamChatOnly ? 'team' : 'all',
            t: ev.t,
        });
        setChatDraft('');
        setChatOpen(false);
    }, [chatDraft, chatDraftEmotes, ownColor, teamChatOnly, broadcastSocial]);

    const handleThrowProjectile = React.useCallback(
        (projectileId: ProjectileId, toColor: PlayerColor) => {
            if (!ownColor || toColor === ownColor) return;
            const ev = createProjectileEvent(projectileId, ownColor, toColor, address?.toLowerCase());
            const sent = broadcastSocial('PROJECTILE', ev as unknown as Record<string, unknown>);
            if (sent) {
                setProjectiles((prev) => [...prev.slice(-7), ev]);
            }
        },
        [ownColor, address, broadcastSocial],
    );

    const opponentSeats = React.useMemo(
        () =>
            players
                .filter((p) => Boolean(ownColor) && p.color !== ownColor)
                .map((p) => ({ color: p.color, name: getDisplayNameHelper(p) })),
        [players, ownColor],
    );
    const isMyTurn = !!ownColor && turnColor === ownColor;
    const showInventory = gameMode === 'power' && !spectatorMode && !!ownColor && canUsePowers;
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

    // ─── Online Post-Match Rematch Vote (15s) + Quick-Search Fallback ────
    const humanPlayers = React.useMemo(() => players.filter((p) => !p.isAi), [players]);
    const isOnlineMultiplayer =
        !isBotMatch &&
        !spectatorMode &&
        Boolean(roomId || serverSeq > 0) &&
        humanPlayers.length >= 2;

    const [rematchProposalId, setRematchProposalId] = useState<string | null>(null);
    const [rematchProposer, setRematchProposer] = useState<{ name: string; color: PlayerColor } | null>(null);
    const [rematchVotes, setRematchVotes] = useState<Partial<Record<PlayerColor, RematchVote>>>({});
    const [rematchDeadlineAt, setRematchDeadlineAt] = useState<number | null>(null);
    const [rematchSecondsLeft, setRematchSecondsLeft] = useState(0);
    const [rematchStatusUI, setRematchStatusUI] = useState<'idle' | 'searching' | 'starting' | 'declined'>('idle');
    const [rematchStatusMsg, setRematchStatusMsg] = useState<string | null>(null);
    const rematchResolvedIdRef = useRef<string | null>(null);

    useEffect(() => {
        if (!localGameState.winner) {
            setRematchProposalId(null);
            setRematchProposer(null);
            setRematchVotes({});
            setRematchDeadlineAt(null);
            setRematchSecondsLeft(0);
            setRematchStatusUI('idle');
            setRematchStatusMsg(null);
            rematchResolvedIdRef.current = null;
        }
    }, [localGameState.winner]);

    useEffect(() => {
        if (!isOnlineMultiplayer || !localGameState.winner) return;
        const onRematchSignal = (ev: Event) => {
            const sig = parseRematchPayload((ev as CustomEvent).detail);
            if (!sig) return;
            if (localGameState.matchId && sig.matchId && sig.matchId !== localGameState.matchId) return;

            if (sig.kind === 'started' && sig.newMatchId) {
                const startKey = `${sig.proposalId}:started`;
                if (rematchResolvedIdRef.current === startKey) return;
                rematchResolvedIdRef.current = startKey;
                setRematchStatusUI('starting');
                setRematchStatusMsg('Starting rematch table...');
                onRematchResolved?.({
                    action: 'rematch_all',
                    gameMode,
                    playerCount,
                    wager,
                    acceptedWallets: [],
                    slotsNeeded: 0,
                    proposalId: sig.proposalId,
                    startedMatchId: sig.newMatchId,
                });
                return;
            }

            if (sig.kind === 'propose') {
                setRematchProposalId((cur) => {
                    if (!cur) {
                        const seatPlayer = players.find((p) => p.color === sig.color);
                        setRematchProposer({
                            name: sig.actor || (seatPlayer ? getDisplayNameHelper(seatPlayer) : sig.color),
                            color: sig.color,
                        });
                        setRematchDeadlineAt(Date.now() + REMATCH_TIMEOUT_MS);
                        setRematchSecondsLeft(Math.ceil(REMATCH_TIMEOUT_MS / 1000));
                        setRematchStatusUI('idle');
                        setRematchStatusMsg(null);
                        return sig.proposalId;
                    }
                    return cur;
                });
                setRematchVotes((prev) => ({ ...prev, [sig.color]: 'accepted' }));
                return;
            }

            if (sig.kind === 'accept' || sig.kind === 'decline') {
                setRematchVotes((prev) => ({
                    ...prev,
                    [sig.color]: sig.kind === 'accept' ? 'accepted' : 'declined',
                }));
            }
        };

        window.addEventListener('ludo-rematch', onRematchSignal);
        return () => window.removeEventListener('ludo-rematch', onRematchSignal);
    }, [isOnlineMultiplayer, localGameState.winner, localGameState.matchId, players, gameMode, playerCount, wager, onRematchResolved]);

    const rematchExpired = rematchDeadlineAt !== null && rematchSecondsLeft === 0;
    useEffect(() => {
        if (!rematchDeadlineAt) return;
        const update = () => {
            const left = Math.max(0, Math.ceil((rematchDeadlineAt - Date.now()) / 1000));
            setRematchSecondsLeft(left);
        };
        update();
        const timer = window.setInterval(update, 400);
        return () => window.clearInterval(timer);
    }, [rematchDeadlineAt]);

    useEffect(() => {
        if (!isOnlineMultiplayer || !localGameState.winner || !rematchProposalId) return;
        if (rematchResolvedIdRef.current === rematchProposalId) return;

        const res = evaluateRematchOutcome({
            votes: rematchVotes,
            humanColors: humanPlayers.map((p) => p.color),
            myColor: ownColor,
            playerCount,
            expired: rematchExpired,
        });

        if (res.outcome === 'pending') return;
        rematchResolvedIdRef.current = rematchProposalId;

        const acceptedWallets = res.acceptedColors
            .map((c) => players.find((p) => p.color === c)?.walletAddress?.toLowerCase())
            .filter((w): w is string => Boolean(w));

        if (res.outcome === 'declined') {
            setRematchStatusUI('declined');
            setRematchStatusMsg('Rematch declined');
            return;
        }

        const resolvedAction: RematchResolutionPlan['action'] =
            res.outcome === 'all_accepted' ? 'rematch_all' : res.outcome;

        if (resolvedAction === 'rematch_all') {
            setRematchStatusUI('starting');
            setRematchStatusMsg('All players accepted · launching rematch...');
        } else {
            setRematchStatusUI('searching');
            setRematchStatusMsg(
                resolvedAction === 'hybrid_quick_search'
                    ? `Opponent declined · filling ${res.slotsNeeded} seat${res.slotsNeeded > 1 ? 's' : ''} (${gameMode.toUpperCase()} · ${playerCount})...`
                    : `Opponent declined · searching ${gameMode.toUpperCase()} ${playerCount}...`,
            );
        }

        const t = window.setTimeout(() => {
            onRematchResolved?.({
                action: resolvedAction,
                gameMode,
                playerCount,
                wager,
                acceptedWallets,
                slotsNeeded: res.slotsNeeded,
                proposalId: rematchProposalId,
            });
        }, 450);
        return () => window.clearTimeout(t);
    }, [
        isOnlineMultiplayer,
        localGameState.winner,
        rematchProposalId,
        rematchVotes,
        rematchExpired,
        humanPlayers,
        ownColor,
        playerCount,
        players,
        gameMode,
        wager,
        onRematchResolved,
    ]);

    const handleRematchClick = React.useCallback(() => {
        if (!isOnlineMultiplayer) {
            resetGame();
            return;
        }
        if (!ownColor || rematchProposalId) return;
        const proposalId =
            typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                ? crypto.randomUUID()
                : `rematch-${Date.now()}`;
        const actor = myPlayer ? getDisplayNameHelper(myPlayer) : ownColor;
        setRematchProposalId(proposalId);
        setRematchProposer({ name: actor, color: ownColor });
        setRematchVotes({ [ownColor]: 'accepted' });
        setRematchDeadlineAt(Date.now() + REMATCH_TIMEOUT_MS);
        setRematchSecondsLeft(Math.ceil(REMATCH_TIMEOUT_MS / 1000));
        setRematchStatusUI('idle');
        setRematchStatusMsg(null);
        broadcastSocial('REMATCH', {
            kind: 'propose',
            proposalId,
            matchId: localGameState.matchId,
            roomCode: roomId ?? undefined,
            color: ownColor,
            wallet: address?.toLowerCase(),
            actor,
            t: Date.now(),
        });
    }, [isOnlineMultiplayer, resetGame, ownColor, rematchProposalId, myPlayer, broadcastSocial, localGameState.matchId, roomId, address]);

    const handleRespondRematch = React.useCallback(
        (accept: boolean) => {
            if (!rematchProposalId || !ownColor) return;
            setRematchVotes((prev) => ({ ...prev, [ownColor]: accept ? 'accepted' : 'declined' }));
            broadcastSocial('REMATCH', {
                kind: accept ? 'accept' : 'decline',
                proposalId: rematchProposalId,
                matchId: localGameState.matchId,
                roomCode: roomId ?? undefined,
                color: ownColor,
                wallet: address?.toLowerCase(),
                actor: myPlayer ? getDisplayNameHelper(myPlayer) : ownColor,
                t: Date.now(),
            });
        },
        [rematchProposalId, ownColor, broadcastSocial, localGameState.matchId, roomId, address, myPlayer],
    );

    const rematchOverlayState: RematchOverlayState | null = React.useMemo(() => {
        if (!isOnlineMultiplayer || !rematchProposalId) return null;
        const totalHumans = humanPlayers.length;
        const acceptedCount = humanPlayers.filter((p) => rematchVotes[p.color] === 'accepted').length;
        const myVote: 'pending' | 'accepted' | 'declined' = ownColor
            ? rematchVotes[ownColor] ?? 'pending'
            : 'pending';
        const status: RematchOverlayState['status'] =
            rematchStatusUI !== 'idle'
                ? rematchStatusUI
                : rematchProposer?.color === ownColor
                  ? 'proposing'
                  : 'invited';
        return {
            status,
            proposerName: rematchProposer?.name,
            secondsLeft: rematchSecondsLeft,
            acceptedCount,
            totalHumans,
            myVote,
            statusMessage: rematchStatusMsg ?? undefined,
            onAccept: () => handleRespondRematch(true),
            onDecline: () => handleRespondRematch(false),
        };
    }, [
        isOnlineMultiplayer,
        rematchProposalId,
        humanPlayers,
        rematchVotes,
        ownColor,
        rematchStatusUI,
        rematchProposer,
        rematchSecondsLeft,
        rematchStatusMsg,
        handleRespondRematch,
    ]);

    // ─── Line 1 Primary Turn Directive (2-line terminal stack above board) ─
    const effectiveMyDice =
        ownColor && localGameState.diceValue !== null && localGameState.diceValue !== undefined
            ? Number(localGameState.diceValue)
            : null;
    const myTokensInHome = ownColor
        ? (localGameState.positions?.[ownColor] || []).filter((pos: number) => Number(pos) === -1).length
        : 0;
    const primaryTurnLine = React.useMemo(
        () =>
            formatPrimaryTurnLine({
                currentPlayer: localGameState.currentPlayer,
                gamePhase: localGameState.gamePhase,
                diceValue: localGameState.diceValue ?? null,
                myColor: ownColor,
                spectatorMode,
                targeting: targeting?.type ?? null,
                activeBoost: localGameState.activeBoost,
                boostPendingDice: localGameState.boostPendingDice ?? null,
                winner: localGameState.winner ?? null,
                myTokensInHome,
                effectiveMyDice,
            }),
        [
            localGameState.currentPlayer,
            localGameState.gamePhase,
            localGameState.diceValue,
            ownColor,
            spectatorMode,
            targeting,
            localGameState.activeBoost,
            localGameState.boostPendingDice,
            localGameState.winner,
            myTokensInHome,
            effectiveMyDice,
        ],
    );
    const spendPower = (type: PowerType) => {
        if (!canSpend || !ownColor) return;
        if (type === 'nuke' || type === 'teleport') {
            setTargeting(cur => {
                const next = cur?.type === type ? null : { type };
                getSoundEngine().play(next ? 'power_arm_target' : 'power_disarm');
                return next;
            });
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

    const [hoveredMoveToken, setHoveredMoveToken] = useState<{ color: PlayerColor; index: number } | null>(null);
    const [transitStatus, setTransitStatus] = useState<BoardTransitStatus>({ finishingKeys: [], returningYardKeys: [] });
    useEffect(() => {
        setHoveredMoveToken(null);
    }, [localGameState.gamePhase, localGameState.currentPlayer, localGameState.diceValue, targeting]);

    const activeMovePreview: MovePreviewTarget | null = React.useMemo(() => {
        if (spectatorMode || targeting || localGameState.gamePhase !== 'moving') return null;
        if (hoveredMoveToken) {
            return computeMovePreview({
                state: localGameState,
                color: hoveredMoveToken.color,
                tokenIndex: hoveredMoveToken.index,
                colorCorner,
                playerCount,
            });
        }
        return computeSingleLegalMovePreview({
            state: localGameState,
            myColor: ownColor,
            colorCorner,
            playerCount,
        });
    }, [spectatorMode, targeting, localGameState, hoveredMoveToken, colorCorner, playerCount, ownColor]);

    const displayedTurnRolls = resolveDisplayedTurnRolls(
        turnRollHistory.player === localGameState.currentPlayer ? turnRollHistory.rolls : [],
        localGameState.consecutiveSixes,
    );

    return (
        <div
            data-theme="default"
            className="board-outer board-match-theme-wrapper w-full h-full"
            onPointerDown={() => {
                if (isMeTier1Afk && myPlayer?.color) {
                    cancelAfk(myPlayer.color);
                }
            }}
        >
            <PlayerRow
                corners={['TL', 'TR']}
                uiSlots={uiSlots}
                players={players}
                localGameState={localGameState}
                handleRoll={handleRoll}
                spectatorMode={spectatorMode}
                myPlayerColor={myPlayer?.color}
                canInteract={isPresentationSynced}
                bustState={bustState}
                turnRolls={displayedTurnRolls}
                onQuickThrow={(toColor, projectileId) => handleThrowProjectile(projectileId, toColor)}
            />

            <BoardTerminalHud line1={primaryTurnLine} line2={feedEvent} />

            <motion.div
                className={`board-area${stableBox ? ' is-locked' : ''}`}
                ref={areaRef}
                animate={
                    reduced
                        ? {}
                        : nukeShaking
                          ? { x: [-5, 5, -4, 4, -2, 2, 0], y: [3, -3, 2, -2, 0] }
                          : isShaking
                            ? { x: [-2, 2, -2, 2, 0] }
                            : {}
                }
                transition={{ duration: nukeShaking ? 0.5 : 0.4 }}
                style={{
                    position: 'relative', width: '100%', cursor: 'pointer',
                    ...(stableBox ? { '--board-area-h': `${stableBox.height}px` } as React.CSSProperties : {}),
                }}
            >
                {!spectatorMode && !localGameState.winner && !localGameState.abortReason && matchAuthorityMode === 'room' && (matchConnectionStatus === 'reconnecting' || roomStatus === 'connecting' || roomStatus === 'failed') && (
                    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 rounded-2xl bg-black/65 backdrop-blur-sm px-4 text-center">
                        <div className="w-7 h-7 border-[3px] border-cyan-500/30 border-t-cyan-400 rounded-full animate-spin" />
                        <span className="font-mono text-xs font-black uppercase tracking-[0.18em] text-cyan-300">
                            Reconnecting to Match Room…
                        </span>
                        {roomStatus === 'failed' && (
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    retryRoom();
                                }}
                                className="px-4 py-1.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black font-mono text-xs font-black uppercase tracking-[0.16em] transition-all active:scale-95"
                            >
                                Retry
                            </button>
                        )}
                    </div>
                )}
                <div
                    className="board-wrapper"
                    style={{
                        position: 'relative',
                        transform: boardRotationDeg !== 0 ? `rotate(${boardRotationDeg}deg)` : undefined,
                        transition: 'transform 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
                        '--active-faction-color': activeColor,
                    } as React.CSSProperties}
                >
                    <BoardGrid
                        squarePx={boardSquarePx}
                        pathCells={pathCells}
                        colorCorner={colorCorner}
                        localGameState={localGameState}
                        activeColor={activeColor}
                        sweepProgress={smoothProgress}
                        pointRotation={pointRotation}
                        counterRotationDeg={counterRotationDeg}
                        powerVfxEvents={powerVfxEvents}
                        movePreview={activeMovePreview}
                    >
                        {(['green', 'red', 'yellow', 'blue'] as const).map((color) => {
                            const isActivePlayer = players.some(p => p.color === color);
                            const finishingSet = new Set(transitStatus.finishingKeys);
                            const returningSet = new Set(transitStatus.returningYardKeys);
                            const rawPositions = localGameState.positions?.[color] as number[] | undefined;
                            // Keep in-flight finishing tokens at step 56 and in-flight captured
                            // victims out of Home Pad until their board animations complete.
                            const tokensInHome = isActivePlayer && rawPositions
                                ? rawPositions
                                      .map((pos: number, idx: number) =>
                                          Number(pos) === -1 && !returningSet.has(`${color}-${idx}`) ? idx : -1,
                                      )
                                      .filter((idx: number) => idx !== -1)
                                : [];
                            const finishedTokens = isActivePlayer && rawPositions
                                ? rawPositions
                                      .map((pos: number, idx: number) =>
                                          Number(pos) === 57 && !finishingSet.has(`${color}-${idx}`) ? idx : -1,
                                      )
                                      .filter((idx: number) => idx !== -1)
                                : [];
                            const positions = rawPositions
                                ? rawPositions.map((pos: number, idx: number) =>
                                      Number(pos) === 57 && finishingSet.has(`${color}-${idx}`) ? 56 : pos,
                                  )
                                : undefined;
                            const actingColor = localGameState.currentPlayer as PlayerColor;
                            const isAssistTarget =
                                playerCount === '2v2' &&
                                localGameState.positions[actingColor]?.every((p: number) => Number(p) === 57) &&
                                getTeammateColor(actingColor, '2v2') === color;
                            const isControllableHome = localGameState.currentPlayer === color || isAssistTarget;
                            const effectiveHomeDice =
                                localGameState.diceValue !== null && localGameState.diceValue !== undefined
                                    ? Number(localGameState.diceValue)
                                    : null;
                            const isOwnControllableTurn =
                                !spectatorMode &&
                                isPresentationSynced &&
                                Boolean(myPlayer?.color) &&
                                (actingColor === myPlayer?.color || isPassAndPlay);
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
                                    onTokenClick={(idx) => handleTokenClick(color, idx, effectiveHomeDice)}
                                    onTokenHover={(idx) => setHoveredMoveToken(idx === null ? null : { color, index: idx })}
                                    isDraggable={isOwnControllableTurn && isActivePlayer && isControllableHome && localGameState.gamePhase === 'moving' && effectiveHomeDice === 6}
                                    counterRotationDeg={counterRotationDeg}
                                    diceValue={effectiveHomeDice}
                                    gamePhase={localGameState.gamePhase}
                                    currentPlayer={isControllableHome ? color : localGameState.currentPlayer}
                                />
                            );
                        })}
                <BoardTokens
                    players={players}
                    localGameState={localGameState}
                    colorCorner={colorCorner}
                    address={address}
                    myColorOverride={myPlayer?.color}
                    canInteract={isPresentationSynced && !spectatorMode}
                    playerCount={playerCount}
                    handleTokenClick={(c, idx) => handleTokenClick(c, idx, localGameState.diceValue)}
                    counterRotationDeg={counterRotationDeg}
                    targetingColor={targeting ? ownColor ?? null : null}
                    onTargetToken={spendTargeted}
                    onTokenHover={setHoveredMoveToken}
                    onTransitStatusChange={setTransitStatus}
                    animationBarrier={animationBarrier}
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

            <BoardProjectileLayer
                projectiles={projectiles}
                uiSlots={uiSlots}
                counterRotationDeg={counterRotationDeg}
            />

            {lxpGain !== null && (
                <motion.div
                    initial={{ opacity: 0, y: 20, scale: 0.8 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -20, scale: 0.8 }}
                    className="absolute top-16 left-1/2 -translate-x-1/2 z-[50] px-4 py-2 bg-black/80 backdrop-blur-md border border-accent/40 rounded-full shadow-[0_0_20px_color-mix(in_srgb,var(--accent)_30%,transparent)] flex items-center gap-2"
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                    <span className="text-sm font-bold label-chrome text-warn">+{lxpGain} XP</span>
                </motion.div>
            )}

              </div>
          </motion.div>

            {isMeKicked && (
                <KickedAlertModal
                    kickReason={myAfk?.kickReason}
                    canWatchLiveArena={Boolean(onInspectInLiveArena)}
                    onWatchLiveArena={onInspectInLiveArena}
                    onReturnToLobby={() => onExitMatch?.()}
                />
            )}

            <MatchStatsOverlay
                open={!!localGameState.winner && !spectatorMode}
                gameState={localGameState}
                players={players}
                // Offline boards never advance the authority seq (stays 0);
                // only a real seq belongs on the receipt.
                seq={serverSeq || null}
                myPlayer={myPlayer}
                playerCount={playerCount}
                wager={wager}
                gameMode={gameMode}
                lxpGain={lxpGain}
                onRematch={handleRematchClick}
                rematchState={rematchOverlayState}
                onExit={onExitMatch}
                onOpenProfile={onOpenProfile}
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
                canInteract={isPresentationSynced}
                bustState={bustState}
                turnRolls={displayedTurnRolls}
                onQuickThrow={(toColor, projectileId) => handleThrowProjectile(projectileId, toColor)}
                centerSlot={
                    <AnimatePresence>
                        {isMeTier1Afk && myAfk && myPlayer?.color && (
                            <AfkReclaimBar
                                afkStats={myAfk}
                                getNow={getRoomServerNow}
                                onReclaim={() => cancelAfk(myPlayer.color)}
                                reducedMotion={reduced}
                            />
                        )}
                    </AnimatePresence>
                }
            />

            {/* Match footer: social controls, shared by classic and power (hidden while spectating). */}
            {!spectatorMode && (<div className={`match-footer ${chatOpen ? 'match-footer-chat' : ''}`}>
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
                            <RichChatField
                                value={chatDraft}
                                emotes={chatDraftEmotes}
                                onChange={(next) => {
                                    setChatDraft(next);
                                    setChatDraftEmotes((items) => retainChatDraftEmotes(next, items));
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        sendChat();
                                    }
                                    if (e.key === 'Escape') setChatOpen(false);
                                }}
                                placeholder={teamChatOnly ? 'Message your teammate…' : 'Message everyone…'}
                                maxLength={80}
                                autoFocus
                                ariaLabel="In-game chat message"
                            />
                            <EmojiPickerPopover
                                open={chatEmojiOpen}
                                onToggle={() => setChatEmojiOpen((value) => !value)}
                                onSelect={(emote) => {
                                    setChatDraft((draft) => {
                                        const next = insertDraftEmote(emote, draft, chatDraftEmotes, 80);
                                        setChatDraftEmotes(next.emotes);
                                        return next.value;
                                    });
                                    setChatEmojiOpen(false);
                                }}
                                label="Add emoji"
                            />
                            <button type="button" className="chat-composer-send" onClick={sendChat} disabled={!chatDraft.trim()}>
                                <LuSend className="w-3.5 h-3.5" />
                                <span>Send</span>
                            </button>
                        </div>
                    </div>
                ) : (
                <>
                <div className="match-footer-slot left">
                    {!spectatorMode && myPlayer && (
                        <EmoteTray
                            myColor={myPlayer.color}
                            opponents={opponentSeats}
                            onThrowProjectile={handleThrowProjectile}
                            onEmote={(event) => {
                                const sent = broadcastSocial('EMOTE', {
                                    emoteId: event.emoteId,
                                    color: event.color,
                                    actor: event.actor,
                                    customText: event.customText,
                                    assetUrl: event.assetUrl,
                                    t: event.t,
                                });
                                if (sent) {
                                    setEmoteFloats((f) => [...f.slice(-4), event]);
                                }
                            }}
                        />
                    )}
                </div>
                <div className="match-footer-slot center">
                    {showInventory && ownColor && (
                        <PowerInventoryDock
                            items={groupedInventory}
                            canSpend={canSpend}
                            isMyTurn={isMyTurn}
                            gamePhase={localGameState.gamePhase}
                            powerSpentThisTurn={Boolean(localGameState.powerSpentThisTurn)}
                            activeBoost={localGameState.activeBoost}
                            activeShields={localGameState.activeShields}
                            ownColor={ownColor}
                            targeting={targeting}
                            chatOpen={chatOpen}
                            matchFinished={Boolean(localGameState.winner)}
                            onSpendPower={spendPower}
                        />
                    )}
                </div>
                <div className="match-footer-slot right flex items-center gap-2">
                    <button
                        type="button"
                        className={`match-foot-pill ${chatOpen ? 'on' : ''}`}
                        onClick={() => setChatOpen((v) => !v)}
                        aria-label="Chat"
                        aria-expanded={chatOpen}
                    >
                        <ChatIcon className="w-3.5 h-3.5 mr-1.5" active={chatOpen} />
                        <span>Chat</span>
                    </button>
                </div>
                </>
                )}
            </div>)}

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

function BoardTerminalHud({
    line1,
    line2,
}: {
    line1: PrimaryTurnLine | null;
    line2: CombatFeedLine | null;
}) {
    const hasLine1 = Boolean(line1 && line1.text.trim().length > 0);
    if (!hasLine1 && !line2) return null;

    const isYours = Boolean(line1 && (line1.tone === 'yours' || line1.tone === 'target'));
    return (
        <div
            className={`board-terminal-hud ${!hasLine1 ? 'is-line2-promoted' : ''}`}
            aria-live="polite"
        >
            {hasLine1 && line1 && (
                <div
                    className={`board-turn-status board-terminal-line1 ${isYours ? 'is-yours' : ''} tone-${line1.tone}`}
                    data-seat-color={line1.color}
                >
                    <span className="board-turn-status-dot shrink-0" />
                    {!isYours && <SimBotIcon className="w-3 h-3 shrink-0 opacity-75" />}
                    <TerminalTypeText
                        key={line1.text}
                        text={line1.text}
                        charMs={16}
                        trailingEllipsis
                    />
                </div>
            )}

            <div className="board-terminal-line2-slot">
                <AnimatePresence mode="wait">
                    {line2 && (
                        <motion.div
                            key={line2.id}
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -4 }}
                            transition={{ duration: 0.16, ease: 'easeOut' }}
                            className={`board-terminal-line2 tone-${line2.tone}`}
                        >
                            <span className="board-terminal-line2-prefix" aria-hidden="true">&gt;</span>
                            <TerminalTypeText
                                key={`${line2.id}-${line2.text}`}
                                text={line2.text}
                                charMs={14}
                                trailingEllipsis
                            />
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}

// Helper for the timer translation
function useBoardLayoutRotation(smoothProgress: any) {
    return useTransform(smoothProgress, [0, 1], [270, -90]);
}
