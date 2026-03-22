# Debugging Matchmaking Deadlock

## Symptoms
- Device A (Host) gets "Matched!"
- Device B (Guest) stuck at "Idle Radar" (0s)

## Hypotheses
1. **Blocking Purge**: `cancelSearch(true, true)` in `startSearch` hangs on Device B, preventing `setStatus('searching')`.
2. **Stale Match Data**: Device A is matching with a stale record, but Device B fails to receive its part of the match.
3. **RPC Inconsistency**: `join_matchmaking` RPC doesn't correctly transition the Guest player if they don't have an existing ticket.

## Investigation Plan
- [ ] Add diagnostic logs to `startSearch` entry/exit.
- [ ] Make `cancelSearch` purge non-blocking.
- [ ] Verify `join_matchmaking` RPC handles guest join without prior ticket.
- [ ] Check for console errors on the "Idle" device.

## Root Cause
[Pending]

## Resolution
[Pending]
