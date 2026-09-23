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
});

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
    const result = gameIntentSchema.safeParse(value);
    if (!result.success) return { ok: false, reason: result.error.issues[0]?.message ?? 'invalid intent' };
    return { ok: true, value: result.data };
}

export function parseGameActionEnvelope(value: unknown): ParseResult<ParsedActionEnvelope> {
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
