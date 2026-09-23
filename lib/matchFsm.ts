/**
 * E5 match lifecycle FSM — single authority for legal phase transitions.
 * Illegal transitions are observable (metered), never silent.
 */

export type MatchPhase =
    | 'idle'
    | 'lobby'
    | 'seating'
    | 'starting'
    | 'live'
    | 'resyncing'
    | 'ended';

export type MatchFsmEvent =
    | { type: 'OPEN_LOBBY' }
    | { type: 'GUEST_SEATED' }
    | { type: 'ALL_SEATED' }
    | { type: 'START' }
    | { type: 'RESYNC_NEEDED' }
    | { type: 'RESYNC_APPLIED' }
    | { type: 'FINISH' }
    | { type: 'HOST_ELECT' }
    | { type: 'RESET' };

export type MatchFsmListener = (
    from: MatchPhase,
    to: MatchPhase,
    event: MatchFsmEvent,
    ok: boolean
) => void;

const TRANSITIONS: Record<MatchPhase, Partial<Record<MatchFsmEvent['type'], MatchPhase>>> = {
    idle: {
        OPEN_LOBBY: 'lobby',
        // Guests may not run hostGame — seating/start can begin from idle.
        GUEST_SEATED: 'seating',
        START: 'starting',
        RESET: 'idle',
    },
    lobby: {
        GUEST_SEATED: 'seating',
        ALL_SEATED: 'seating',
        START: 'starting',
        RESET: 'idle',
    },
    seating: {
        GUEST_SEATED: 'seating',
        ALL_SEATED: 'seating',
        START: 'starting',
        RESET: 'idle',
    },
    starting: {
        START: 'live',
        RESYNC_NEEDED: 'resyncing',
        RESET: 'idle',
    },
    live: {
        START: 'live',
        RESYNC_NEEDED: 'resyncing',
        HOST_ELECT: 'live',
        FINISH: 'ended',
        RESET: 'idle',
    },
    resyncing: {
        RESYNC_APPLIED: 'live',
        START: 'live',
        FINISH: 'ended',
        HOST_ELECT: 'resyncing',
        RESET: 'idle',
    },
    ended: {
        RESET: 'idle',
        RESYNC_NEEDED: 'ended',
    },
};

export function nextPhase(from: MatchPhase, event: MatchFsmEvent): MatchPhase | null {
    return TRANSITIONS[from][event.type] ?? null;
}

export function canTransition(from: MatchPhase, event: MatchFsmEvent): boolean {
    return nextPhase(from, event) !== null;
}

export function createMatchFsm(initial: MatchPhase = 'idle') {
    let phase: MatchPhase = initial;
    const listeners = new Set<MatchFsmListener>();
    let illegal = 0;

    return {
        get phase(): MatchPhase {
            return phase;
        },
        get illegalTransitions(): number {
            return illegal;
        },
        can(event: MatchFsmEvent): boolean {
            return canTransition(phase, event);
        },
        send(event: MatchFsmEvent): MatchPhase {
            const to = nextPhase(phase, event);
            const _ok = to !== null;
            if (!to) {
                illegal += 1;
                for (const fn of listeners) fn(phase, phase, event, false);
                return phase;
            }
            const from = phase;
            phase = to;
            for (const fn of listeners) fn(from, to, event, true);
            return phase;
        },
        subscribe(fn: MatchFsmListener): () => void {
            listeners.add(fn);
            return () => listeners.delete(fn);
        },
        reset(): void {
            phase = 'idle';
            illegal = 0;
        },
    };
}

export type MatchFsm = ReturnType<typeof createMatchFsm>;
