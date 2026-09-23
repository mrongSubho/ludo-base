/**
 * N4 wire schemas — parse-or-drop on every inbound multiplayer payload.
 * Shared by client and (via copy/sync discipline) Edge boundaries.
 */

import { z } from 'zod';

export const playerColorSchema = z.enum(['green', 'red', 'yellow', 'blue']);
export const playerCountSchema = z.enum(['1v1', '4P', '2v2']);
export const powerTypeSchema = z.enum(['shield', 'boost', 'nuke', 'teleport']);

export const gameIntentSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('REQUEST_ROLL'),
        payload: z.object({ value: z.number().int().min(1).max(6).optional() }),
        sender: z.string().optional(),
        intentId: z.string().min(1),
    }),
    z.object({
        type: z.literal('REQUEST_MOVE'),
        payload: z.object({
            color: playerColorSchema,
            tokenIndex: z.number().int().min(0).max(3),
            diceValue: z.number().int().min(1).max(6).optional(),
        }),
        sender: z.string().optional(),
        intentId: z.string().min(1),
    }),
    z.object({
        type: z.literal('DICE_COMMIT'),
        payload: z.object({ hash: z.string().min(1) }),
        sender: z.string().optional(),
        intentId: z.string().min(1),
    }),
    z.object({
        type: z.literal('DICE_REVEAL'),
        payload: z.object({ nonce: z.string().min(1) }),
        sender: z.string().optional(),
        intentId: z.string().min(1),
    }),
    z.object({
        type: z.literal('CMD_REQUEST_TRUST'),
        payload: z.object({
            color: playerColorSchema,
            isBotTrusted: z.boolean(),
            isKicked: z.boolean(),
        }),
        sender: z.string().optional(),
        intentId: z.string().min(1),
    }),
]);

export const gameActionEnvelopeSchema = z.object({
    type: z.string().min(1),
    payload: z.unknown().optional(),
    actionId: z.string().min(1).optional(),
    sender: z.string().optional(),
    intentId: z.string().min(1).optional(),
    /** N4 — reject unknown-major; tolerate missing (legacy) or known-minor. */
    protocolVersion: z.string().max(16).optional(),
});

/** Current wire protocol version (semver-ish major.minor). */
export const PROTOCOL_VERSION = '1.0';

/** Pre-parse size cap (bytes) — reject before Zod on huge payloads. */
export const MAX_MESSAGE_BYTES = 32 * 1024;

export function protocolVersionOk(version: string | undefined | null): boolean {
    if (!version) return true; // legacy clients
    const major = version.split('.')[0];
    return major === PROTOCOL_VERSION.split('.')[0];
}

export function withinSizeCap(value: unknown, maxBytes = MAX_MESSAGE_BYTES): boolean {
    try {
        const len = JSON.stringify(value)?.length ?? 0;
        return len <= maxBytes;
    } catch {
        return false;
    }
}

export const matchStateRowSchema = z.object({
    seq: z.number().int().min(0),
    state: z.record(z.string(), z.unknown()),
});

export const matchActionErrorSchema = z.object({
    error: z.string(),
    code: z
        .enum([
            'STALE_SEQ',
            'DUPLICATE_ACTION',
            'NOT_AUTHORIZED',
            'MATCH_NOT_FOUND',
            'MATCH_FINISHED',
            'ILLEGAL_ACTION',
            'ROLL_NOT_FOUND',
            'ROLL_CONSUMED',
            'SESSION_EXPIRED',
        ])
        .optional(),
    seq: z.number().int().min(0).optional(),
});

export const joinRequestSchema = z.object({
    type: z.literal('JOIN_REQUEST'),
    intentId: z.string().min(1),
    sender: z.string().optional(),
    payload: z.object({
        name: z.string().min(1).max(64).optional(),
        avatar: z.string().max(256).optional(),
        walletAddress: z.string().min(1).optional(),
        roomSecret: z.string().optional(),
    }),
});

export const syncProfileSchema = z.object({
    type: z.literal('SYNC_PROFILE'),
    intentId: z.string().optional(),
    sender: z.string().optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
});

export type ParsedIntent = z.infer<typeof gameIntentSchema>;
export type ParsedActionEnvelope = z.infer<typeof gameActionEnvelopeSchema>;
export type ParsedMatchStateRow = z.infer<typeof matchStateRowSchema>;

export type ParseResult<T> =
    | { ok: true; value: T }
    | { ok: false; reason: string };

export function parseGameIntent(value: unknown): ParseResult<ParsedIntent> {
    if (!withinSizeCap(value)) return { ok: false, reason: 'size_cap' };
    const result = gameIntentSchema.safeParse(value);
    if (!result.success) return { ok: false, reason: result.error.issues[0]?.message ?? 'invalid intent' };
    return { ok: true, value: result.data };
}

export function parseGameActionEnvelope(value: unknown): ParseResult<ParsedActionEnvelope> {
    if (!withinSizeCap(value)) return { ok: false, reason: 'size_cap' };
    const envelope = value as { protocolVersion?: string } | null;
    if (!protocolVersionOk(envelope?.protocolVersion)) {
        return { ok: false, reason: 'protocol_version' };
    }
    const result = gameActionEnvelopeSchema.safeParse(value);
    if (!result.success) return { ok: false, reason: result.error.issues[0]?.message ?? 'invalid action' };
    return { ok: true, value: result.data };
}

export function parseMatchStateRow(value: unknown): ParseResult<ParsedMatchStateRow> {
    const result = matchStateRowSchema.safeParse(value);
    if (!result.success) return { ok: false, reason: result.error.issues[0]?.message ?? 'invalid match_state' };
    return { ok: true, value: result.data };
}

export function parseJoinRequest(value: unknown): ParseResult<z.infer<typeof joinRequestSchema>> {
    const result = joinRequestSchema.safeParse(value);
    if (!result.success) return { ok: false, reason: result.error.issues[0]?.message ?? 'invalid join' };
    return { ok: true, value: result.data };
}

export function parseSyncProfile(value: unknown): ParseResult<z.infer<typeof syncProfileSchema>> {
    const result = syncProfileSchema.safeParse(value);
    if (!result.success) return { ok: false, reason: result.error.issues[0]?.message ?? 'invalid sync_profile' };
    return { ok: true, value: result.data };
}

/** N6 — spectator broadcast envelope (listen-only game-action). */
export const spectatorBroadcastSchema = z.object({
    type: z.enum([
        'SYNC_STATE',
        'ROLL_DICE',
        'DICE_REVEAL',
        'MOVE_TOKEN',
        'TURN_SWITCH',
        'START_GAME',
        'BET_WINDOW_OPEN',
        'BET_WINDOW_CLOSED',
    ]),
    gameState: z.record(z.string(), z.unknown()).optional(),
    actionId: z.string().optional(),
    /** loose payload bag — validated per-type below */
    rest: z.record(z.string(), z.unknown()).optional(),
});

export const betWindowOpenSchema = z.object({
    windowId: z.string().min(1),
    betType: z.string().min(1),
    expiresAt: z.number(),
    matchId: z.string().optional(),
});

export const betWindowClosedSchema = z.object({
    windowId: z.string().min(1),
    windowClosedAt: z.string().min(1),
});

export function parseSpectatorBroadcast(value: unknown): ParseResult<z.infer<typeof spectatorBroadcastSchema>> {
    if (!value || typeof value !== 'object') return { ok: false, reason: 'not object' };
    const v = value as Record<string, unknown>;
    const type = v.type;
    const allowed = [
        'SYNC_STATE', 'ROLL_DICE', 'DICE_REVEAL', 'MOVE_TOKEN', 'TURN_SWITCH',
        'START_GAME', 'BET_WINDOW_OPEN', 'BET_WINDOW_CLOSED',
    ];
    if (typeof type !== 'string' || !allowed.includes(type)) {
        return { ok: false, reason: `unknown spectator event ${String(type)}` };
    }
    return {
        ok: true,
        value: {
            type: type as z.infer<typeof spectatorBroadcastSchema>['type'],
            gameState: (v.gameState as Record<string, unknown>) || undefined,
            actionId: typeof v.actionId === 'string' ? v.actionId : undefined,
        },
    };
}

export function parseBetWindowOpen(value: unknown): ParseResult<z.infer<typeof betWindowOpenSchema>> {
    const result = betWindowOpenSchema.safeParse(value);
    if (!result.success) return { ok: false, reason: result.error.issues[0]?.message ?? 'invalid bet open' };
    return { ok: true, value: result.data };
}

export function parseBetWindowClosed(value: unknown): ParseResult<z.infer<typeof betWindowClosedSchema>> {
    const result = betWindowClosedSchema.safeParse(value);
    if (!result.success) return { ok: false, reason: result.error.issues[0]?.message ?? 'invalid bet close' };
    return { ok: true, value: result.data };
}
