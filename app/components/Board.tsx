/* eslint-disable @typescript-eslint/no-explicit-any -- lint burn-down quarantine 2026-09-23 */
import React, { useState, useEffect, useRef } from 'react';
import { motion, useMotionValue, animate, useTransform } from 'framer-motion';
import { LuSend } from 'react-icons/lu';
import Leaderboard from './Leaderboard';
import PlayerProfileSheet from './PlayerProfileSheet';
import { PlayerColor, PowerType, PowerItem } from '@/lib/types';
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

// Modular Components
import { HomeBlock } from './BoardHome';
import { BoardTokens } from './BoardTokens';
import { BoardGrid } from './BoardGrid';
import {
    IdleWarningOverlay,
    NameOverlay,
    StatusNotification,
} from './BoardOverlays';
import { ChatIcon, SimBotIcon } from './icons';
import { MatchStatsOverlay, type RematchOverlayState } from './MatchStatsOverlay';
import { TerminalTypeText } from './TerminalTypeText';
import {
    REMATCH_TIMEOUT_MS,
    evaluateRematchOutcome,
    parseRematchPayload,
    type RematchVote,
} from '@/lib/rematch';
import { usePoolClaim } from '@/hooks/useChipsPool';
import { EmoteTray, parseEmotePayload } from './EmoteTray';
import { EmojiPickerPopover } from './EmojiPicker';
import { RichChatField } from './RichChatField';
import { encodeChatDraft, insertDraftEmote, retainChatDraftEmotes, type ChatDraftEmote } from '@/lib/emotes';
import type { EmoteEvent } from '@/lib/emotes';
import type { ChatEvent } from '@/lib/chat';
import { parseChatPayload, clampChatText, chatTtlMs } from '@/lib/chat';
import { EMOTE_TTL_MS } from '@/lib/emotes';
import type { GameActionPayload } from '@/lib/types';
import { getHopSamples } from '@/lib/perf/budget';
import { installPerfDebugHook } from '@/lib/perf/report';
import { PlayerRow, getDisplayNameHelper, type BoardSelfPrompt } from './PlayerInfoRow';

// Modular Hooks
import { useBoardLayout } from '@/hooks/useBoardLayout';
import { useBoardAudio } from '@/hooks/useBoardAudio';
import { getSoundEngine } from '@/lib/audio/SoundEngine';
import { emoteSoundIdFor } from '@/lib/audio/boardAudioState';

export interface RematchResolutionPlan {
    action: 'rematch_all' | 'hybrid_quick_search' | 'solo_quick_search';
    gameMode: 'classic' | 'power';
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
    onOpenChat: _onOpenChat,
    onRematchResolved,
}: {
    showLeaderboard?: boolean;
    onToggleLeaderboard?: (show: boolean) => void;
    playerCount?: '1v1' | '4P' | '2v2';
    gameMode?: 'classic' | 'power';
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
    /** Online post-match rematch vote resolved (all accepted or quick-search fallback). */
    onRematchResolved?: (plan: RematchResolutionPlan) => void;
}) {
    // Effective identity (wallet or guest id) so guests resolve as human.
    const { address } = useCurrentUser();
    const { roomId, participants, broadcastAction, serverSeq } = useTeamUp();
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
        address: spectatorMode ? undefined : address,
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
    // REA-21: the rotation hook was called inline in the JSX props below
    // (`pointRotation={useBoardLayoutRotation(...)}`) — legal but fragile (a
    // conditional render path would break hook order) and re-created per
    // render. Hoisted to component scope like every other hook.
    const pointRotation = useBoardLayoutRotation(smoothProgress);

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
        broadcastAction('CHAT', {
            text,
            color: ownColor,
            audience: teamChatOnly ? 'team' : 'all',
            t: ev.t,
        } as GameActionPayload<'CHAT'>);
        setChatDraft('');
        setChatOpen(false);
    }, [chatDraft, chatDraftEmotes, ownColor, teamChatOnly, broadcastAction]);
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
        broadcastAction('REMATCH', {
            kind: 'propose',
            proposalId,
            matchId: localGameState.matchId,
            roomCode: roomId ?? undefined,
            color: ownColor,
            wallet: address?.toLowerCase(),
            actor,
            t: Date.now(),
        });
    }, [isOnlineMultiplayer, resetGame, ownColor, rematchProposalId, myPlayer, broadcastAction, localGameState.matchId, roomId, address]);

    const handleRespondRematch = React.useCallback(
        (accept: boolean) => {
            if (!rematchProposalId || !ownColor) return;
            setRematchVotes((prev) => ({ ...prev, [ownColor]: accept ? 'accepted' : 'declined' }));
            broadcastAction('REMATCH', {
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
        [rematchProposalId, ownColor, broadcastAction, localGameState.matchId, roomId, address, myPlayer],
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

    // ─── Bottom Self Prompt (middle of bottom two player zones) ──────────
    const effectiveMyDice =
        ownColor && localGameState.diceValue !== null && localGameState.diceValue !== undefined
            ? Number(localGameState.diceValue) +
              (localGameState.activeBoost === localGameState.currentPlayer || localGameState.activeBoost === ownColor
                  ? 6
                  : 0)
            : null;
    const myTokensInHome = ownColor
        ? (localGameState.positions?.[ownColor] || []).filter((pos: number) => Number(pos) === -1).length
        : 0;
    const selfPrompt: BoardSelfPrompt | null = React.useMemo(() => {
        if (spectatorMode || !isMyTurn || Boolean(localGameState.winner)) return null;
        if (targeting) return { label: 'Tap target token', kind: 'target' };
        if (localGameState.gamePhase === 'moving') {
            if (effectiveMyDice === 6 && myTokensInHome > 0) {
                return { label: 'Deploy [6] or move', kind: 'deploy' };
            }
            return { label: 'Select a token', kind: 'move' };
        }
        if (localGameState.gamePhase === 'rolling' && localGameState.diceValue === null) {
            return { label: 'Roll to start', kind: 'roll' };
        }
        return { label: 'Move in progress', kind: 'move' };
    }, [spectatorMode, isMyTurn, localGameState.winner, targeting, localGameState.gamePhase, localGameState.diceValue, effectiveMyDice, myTokensInHome]);
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

            <BoardTurnStatus
                currentPlayer={localGameState.currentPlayer}
                myColor={myPlayer?.color}
                spectatorMode={spectatorMode}
            />

            <motion.div
                className={`board-area${stableBox ? ' is-locked' : ''}`}
                ref={areaRef}
                animate={isShaking ? { x: [-2, 2, -2, 2, 0] } : {}}
                transition={{ duration: 0.4 }}
                style={{
                    position: 'relative', width: '100%', cursor: 'pointer',
                    ...(stableBox ? { '--board-area-h': `${stableBox.height}px` } as React.CSSProperties : {}),
                }}
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
                            const actingColor = localGameState.currentPlayer as PlayerColor;
                            const isAssistTarget =
                                playerCount === '2v2' &&
                                localGameState.positions[actingColor]?.every((p: number) => Number(p) === 57) &&
                                getTeammateColor(actingColor, '2v2') === color;
                            const isControllableHome = localGameState.currentPlayer === color || isAssistTarget;
                            const effectiveHomeDice =
                                localGameState.diceValue !== null && localGameState.diceValue !== undefined
                                    ? Number(localGameState.diceValue) +
                                      (localGameState.activeBoost === localGameState.currentPlayer || localGameState.activeBoost === color ? 6 : 0)
                                    : null;
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
                                    isDraggable={isActivePlayer && isControllableHome && localGameState.gamePhase === 'moving' && effectiveHomeDice === 6}
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
                    className="absolute top-16 left-1/2 -translate-x-1/2 z-[50] px-4 py-2 bg-black/80 backdrop-blur-md border border-accent/40 rounded-full shadow-[0_0_20px_color-mix(in_srgb,var(--accent)_30%,transparent)] flex items-center gap-2"
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                    <span className="text-sm font-bold label-chrome text-warn">+{lxpGain} XP</span>
                </motion.div>
            )}

              </div>

             <StatusNotification message={localGameState.captureMessage ?? null} />
             <IdleWarningOverlay idleWarning={localGameState.idleWarning} myPlayer={myPlayer} onCancelAfk={cancelAfk} />
         </motion.div>

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
                centerPrompt={selfPrompt}
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

function BoardTurnStatus({
    currentPlayer,
    myColor,
    spectatorMode,
}: {
    currentPlayer: PlayerColor;
    myColor?: PlayerColor;
    spectatorMode: boolean;
}) {
    const isMyTurn = !spectatorMode && !!myColor && currentPlayer === myColor;
    if (isMyTurn) return null;

    const label = spectatorMode
        ? `Watching ${currentPlayer}`
        : `Waiting for ${currentPlayer}`;

    return (
        <div className="board-turn-status" aria-live="polite">
            <span className="board-turn-status-dot" />
            <SimBotIcon className="w-3 h-3 shrink-0 opacity-70" />
            <TerminalTypeText key={label} text={label} charMs={18} />
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
        <svg viewBox="0 0 24 24" fill="none" stroke="#2dd4bf" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={cls}>
            <path d="M4 12a8 8 0 0 1 14-5l2 2" />
            <path d="M20 4v5h-5" />
            <path d="M20 12a8 8 0 0 1-14 5l-2-2" />
            <path d="M4 20v-5h5" />
        </svg>
    );
}
