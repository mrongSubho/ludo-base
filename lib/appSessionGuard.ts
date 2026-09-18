/**
 * Pure session-guard state machine for the SIWE app session (chat / profile /
 * settings — never match moves). Framework-free so the reprompt policy is
 * unit-testable (see scripts/session-guard-sim.ts); hooks/useAppSession.ts is
 * a thin React binding over the module-level singleton below.
 *
 * Why this exists (signing-storm fix): the old funnel had per-instance locks,
 * no backoff, no rejection cooldown, and no terminal failure state. With ~15
 * hook instances and 2s/4s/5s/15s/20s/30s timer pollers all calling
 * ensureAppSession(), a wallet that could never verify (ERC-6492 smart
 * accounts against an ecrecover-only server) was reprompted on the fastest
 * active cadence forever — a popup storm, one per instance per tick.
 *
 * Policy enforced here, per wallet address:
 *   1. SINGLETON + SHARED IN-FLIGHT: concurrent ensure() calls for the same
 *      address share one promise → N mounted instances produce ONE popup.
 *   2. USER-REJECTION COOLDOWN: a reject (code 4001 / rejected-message)
 *      suppresses reprompts for REJECT_COOLDOWN_MS unless forced.
 *   3. VERIFY-FAILURE BACKOFF: consecutive verify failures gate the next
 *      attempt by VERIFY_BACKOFF_MS[failCount-1] (then the last entry).
 *   4. TERMINAL STATE: after MAX_VERIFY_FAILURES consecutive verify
 *      failures the address enters a non-retrying terminal state —
 *      ensure() returns null WITHOUT signing and surfaces `lastError`
 *      instead of reprompting. Terminal clears on: address change (separate
 *      entry), clear(), or an explicit forced (user-initiated) retry.
 *
 * The guard never touches the network or DOM: signing, verify-POST, and
 * persistence are injected callbacks so the policy is deterministic under an
 * injected clock.
 */

export interface GuardStored {
    sessionId: string;
    wallet: string;
    expiresAt: string;
}

export interface SignOutput {
    signature: string;
    /** Opaque caller context (e.g. the verify-POST body) threaded to verify(). */
    body: unknown;
}

export interface GuardSignDeps {
    /** Build the SIWE message AND wallet-sign it. Rejects on user rejection. */
    sign: () => Promise<SignOutput>;
    /** POST the signature to /api/siwe/verify. */
    verify: (
        signed: SignOutput,
    ) => Promise<
        | { ok: true; sessionId: string; expiresAt: string }
        | { ok: false; code: string }
    >;
    /** Persist a fresh session (e.g. localStorage). */
    persist: (stored: GuardStored) => void;
}

export type EnsureReason =
    | 'session'
    | 'no-address'
    | 'in-flight-shared'
    | 'cooldown-reject'
    | 'backoff-verify'
    | 'terminal-verify-failed'
    | 'rejected'
    | 'verify-failed';

export interface EnsureResult {
    sessionId: string | null;
    reason: EnsureReason;
}

export interface GuardSnapshot {
    sessionId: string | null;
    verifyFailed: boolean;
    lastError: string | null;
}

export interface GuardOptions {
    maxVerifyFailures?: number;
    verifyBackoffMs?: number[];
    rejectCooldownMs?: number;
}

interface Entry {
    sessionId: string | null;
    expiresAtMs: number;
    inFlight: Promise<EnsureResult> | null;
    lastRejectAt: number;
    consecVerifyFails: number;
    nextRetryAt: number;
    terminal: boolean;
    lastError: string | null;
}

export const DEFAULT_MAX_VERIFY_FAILURES = 3;
export const DEFAULT_VERIFY_BACKOFF_MS = [15_000, 60_000];
export const DEFAULT_REJECT_COOLDOWN_MS = 60_000;

function newEntry(): Entry {
    return {
        sessionId: null,
        expiresAtMs: 0,
        inFlight: null,
        lastRejectAt: 0,
        consecVerifyFails: 0,
        nextRetryAt: 0,
        terminal: false,
        lastError: null,
    };
}

export function isUserRejection(err: unknown): boolean {
    const code = (err as { code?: unknown } | null)?.code;
    if (code === 4001 || code === 'ACTION_REJECTED') return true;
    const msg = String((err as Error)?.message || err || '');
    return /reject|cancelled|canceled|denied|disapproved/i.test(msg);
}

export class AppSessionGuard {
    private entries = new Map<string, Entry>();
    private listeners = new Set<() => void>();
    private readonly maxVerifyFailures: number;
    private readonly verifyBackoffMs: number[];
    private readonly rejectCooldownMs: number;
    private readonly now: () => number;

    constructor(opts?: GuardOptions & { now?: () => number }) {
        this.maxVerifyFailures = opts?.maxVerifyFailures ?? DEFAULT_MAX_VERIFY_FAILURES;
        this.verifyBackoffMs = opts?.verifyBackoffMs ?? DEFAULT_VERIFY_BACKOFF_MS;
        this.rejectCooldownMs = opts?.rejectCooldownMs ?? DEFAULT_REJECT_COOLDOWN_MS;
        this.now = opts?.now ?? (() => Date.now());
    }

    subscribe = (fn: () => void): (() => void) => {
        this.listeners.add(fn);
        return () => {
            this.listeners.delete(fn);
        };
    };

    private emit(): void {
        for (const fn of this.listeners) {
            try {
                fn();
            } catch {
                /* listener errors must not break the guard */
            }
        }
    }

    private entryFor(address: string): { key: string; entry: Entry } {
        const key = address.toLowerCase();
        let entry = this.entries.get(key);
        if (!entry) {
            entry = newEntry();
            this.entries.set(key, entry);
        }
        return { key, entry };
    }

    /** Hydrate a cached session (e.g. from localStorage on address change). */
    setCached(address: string, stored: GuardStored | null): void {
        const { entry } = this.entryFor(address);
        if (
            stored &&
            stored.wallet.toLowerCase() === address.toLowerCase() &&
            Date.parse(stored.expiresAt) > this.now()
        ) {
            entry.sessionId = stored.sessionId;
            entry.expiresAtMs = Date.parse(stored.expiresAt);
            entry.consecVerifyFails = 0;
            entry.terminal = false;
            entry.lastError = null;
        } else {
            entry.sessionId = null;
            entry.expiresAtMs = 0;
        }
        this.emit();
    }

    /** Forget everything for an address (disconnect / explicit clear). */
    clear(address: string): void {
        this.entries.delete(address.toLowerCase());
        this.emit();
    }

    getSnapshot(address: string | undefined): GuardSnapshot {
        if (!address) return { sessionId: null, verifyFailed: false, lastError: null };
        const entry = this.entries.get(address.toLowerCase());
        if (!entry) return { sessionId: null, verifyFailed: false, lastError: null };
        const live =
            !!entry.sessionId && entry.expiresAtMs > this.now() ? entry.sessionId : null;
        return { sessionId: live, verifyFailed: entry.terminal, lastError: entry.lastError };
    }

    async ensure(
        address: string | undefined,
        deps: GuardSignDeps,
        opts?: { force?: boolean },
    ): Promise<EnsureResult> {
        if (!address) return { sessionId: null, reason: 'no-address' };
        const force = !!opts?.force;
        const now = this.now();
        const { entry } = this.entryFor(address);

        // Cached live session — no popup, reset failure budget.
        if (entry.sessionId && entry.expiresAtMs > now) {
            return { sessionId: entry.sessionId, reason: 'session' };
        }
        entry.sessionId = null;

        // One shared promise per address: N hook instances → ONE popup.
        if (entry.inFlight) {
            const shared = await entry.inFlight;
            return { sessionId: shared.sessionId, reason: 'in-flight-shared' };
        }

        if (!force) {
            if (entry.terminal) {
                return { sessionId: null, reason: 'terminal-verify-failed' };
            }
            if (now < entry.nextRetryAt) {
                return {
                    sessionId: null,
                    reason:
                        entry.consecVerifyFails > 0 ? 'backoff-verify' : 'cooldown-reject',
                };
            }
        }

        const run: Promise<EnsureResult> = (async (): Promise<EnsureResult> => {
            let signed: SignOutput;
            try {
                signed = await deps.sign();
            } catch (err) {
                if (isUserRejection(err)) {
                    // User said no: cooldown, NOT terminal. A reject shows
                    // liveness, so the verify-failure budget resets.
                    entry.lastRejectAt = this.now();
                    entry.consecVerifyFails = 0;
                    entry.nextRetryAt = this.now() + this.rejectCooldownMs;
                    entry.lastError = 'rejected';
                    this.emit();
                    return { sessionId: null, reason: 'rejected' };
                }
                // Unknown sign transport error: back off like a verify
                // failure so a broken pipe cannot spin timers either.
                return this.recordVerifyFailure(entry, 'sign-error');
            }
            let verdict: Awaited<ReturnType<GuardSignDeps['verify']>>;
            try {
                verdict = await deps.verify(signed);
            } catch {
                return this.recordVerifyFailure(entry, 'network-error');
            }
            if (!verdict.ok) {
                return this.recordVerifyFailure(entry, verdict.code || 'verify-failed');
            }
            entry.sessionId = verdict.sessionId;
            entry.expiresAtMs = Date.parse(verdict.expiresAt);
            entry.consecVerifyFails = 0;
            entry.nextRetryAt = 0;
            entry.terminal = false;
            entry.lastError = null;
            try {
                deps.persist({
                    sessionId: verdict.sessionId,
                    wallet: address,
                    expiresAt: verdict.expiresAt,
                });
            } catch {
                /* persistence is best-effort; the session still counts */
            }
            this.emit();
            return { sessionId: verdict.sessionId, reason: 'session' };
        })();

        entry.inFlight = run;
        try {
            return await run;
        } finally {
            entry.inFlight = null;
        }
    }

    private recordVerifyFailure(entry: Entry, code: string): EnsureResult {
        const n = entry.consecVerifyFails + 1;
        entry.consecVerifyFails = n;
        entry.lastError = code;
        if (n >= this.maxVerifyFailures) {
            // Terminal non-retrying state: surface the error instead of
            // reprompting. Cleared by clear(), address change, or force.
            entry.terminal = true;
            entry.nextRetryAt = Number.POSITIVE_INFINITY;
        } else {
            const wait =
                this.verifyBackoffMs[
                    Math.min(n - 1, this.verifyBackoffMs.length - 1)
                ];
            entry.nextRetryAt = this.now() + wait;
        }
        this.emit();
        return { sessionId: null, reason: 'verify-failed' };
    }

    /** Test/SSR helper: number of tracked addresses. */
    get size(): number {
        return this.entries.size;
    }
}
