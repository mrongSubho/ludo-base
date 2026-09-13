import type { MatchConnectionStatus } from './matchProtocol';

interface MatchTimerPolicyInput {
    isNetworked: boolean;
    connectionStatus: MatchConnectionStatus;
    hasAuthoritativeSnapshot: boolean;
}

/**
 * Local countdowns are only valid after a networked client has applied a
 * server snapshot since its latest reconnect. Offline matches remain local.
 */
export function shouldRunMatchTimer({
    isNetworked,
    connectionStatus,
    hasAuthoritativeSnapshot,
}: MatchTimerPolicyInput): boolean {
    if (!isNetworked) return connectionStatus !== 'ended';
    return connectionStatus === 'connected' && hasAuthoritativeSnapshot;
}
