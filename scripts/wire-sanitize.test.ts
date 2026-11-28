import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeGameStateForWire } from '../lib/wireSanitize';

test('PW-1/PW-2: sanitizeGameStateForWire strips board power tiles, powerTileSeed, and masks opponent hands', () => {
    const rawState = {
        powerTileSeed: 987654321,
        powerTiles: [
            { r: 2, c: 3, type: 'nuke' },
            { r: 5, c: 5, type: 'shield' },
        ],
        playerPowers: {
            green: [{ type: 'boost', expiresAt: 1700001000 }],
            red: [{ type: 'nuke', expiresAt: 1700002000 }],
            yellow: [{ type: 'shield', expiresAt: 1700003000 }],
            blue: [{ type: 'teleport', expiresAt: 1700004000 }],
        },
    };

    // 1. Viewer is 'green':
    const sanitizedForGreen = sanitizeGameStateForWire(rawState, 'green');

    // powerTileSeed must never reach the wire
    assert.equal('powerTileSeed' in sanitizedForGreen, false, 'powerTileSeed must be stripped');

    // Board tiles must not leak type
    assert.deepEqual(sanitizedForGreen.powerTiles, [{ r: 2, c: 3 }, { r: 5, c: 5 }]);

    // Own color ('green') keeps type
    assert.equal(sanitizedForGreen.playerPowers.green[0].type, 'boost');
    assert.equal(sanitizedForGreen.playerPowers.green[0].expiresAt, 1700001000);

    // Opponent colors ('red', 'yellow', 'blue') must have type masked (undefined)
    assert.equal(sanitizedForGreen.playerPowers.red[0].type, undefined, 'opponent red power type must be redacted');
    assert.equal(sanitizedForGreen.playerPowers.yellow[0].type, undefined, 'opponent yellow power type must be redacted');
    assert.equal(sanitizedForGreen.playerPowers.blue[0].type, undefined, 'opponent blue power type must be redacted');

    // Expiries remain for countdown timers
    assert.equal(sanitizedForGreen.playerPowers.red[0].expiresAt, 1700002000);

    // 2. Spectator (no viewerColor): all power types must be masked
    const sanitizedForSpectator = sanitizeGameStateForWire(rawState);
    assert.equal(sanitizedForSpectator.playerPowers.green[0].type, undefined);
    assert.equal(sanitizedForSpectator.playerPowers.red[0].type, undefined);
});

test('PW-2 regression guard: local client re-attaches known power types when receiving wire state', () => {
    // Simulate guest local state before broadcast
    const localPrev = {
        powerTiles: [{ r: 2, c: 3, type: 'nuke' }],
        playerPowers: {
            green: [{ type: 'boost', expiresAt: 1700001000 }], // guest is green
            red: [{ type: undefined, expiresAt: 1700002000 }],  // opponent is red (already typeless)
        },
    };

    // Broadcast arrives from wire (no viewerColor, so all powers arrived typeless)
    const incomingWireState = {
        powerTiles: [{ r: 2, c: 3 }],
        playerPowers: {
            green: [{ type: undefined, expiresAt: 1700001000 }], // green was sanitized on wire!
            red: [{ type: undefined, expiresAt: 1700002000 }],
        },
    };

    type PowerSlot = { type?: string; expiresAt?: number };
    // Re-attach local power types logic (identical to applyServerState)
    const playerPowers = { ...(incomingWireState.playerPowers || localPrev.playerPowers) } as Record<string, PowerSlot[]>;
    if (localPrev.playerPowers) {
        for (const [color, items] of Object.entries(localPrev.playerPowers)) {
            const serverItems = playerPowers[color];
            if (!serverItems || !items) continue;
            playerPowers[color] = serverItems.map((sItem: PowerSlot, idx: number) => {
                if (sItem.type !== undefined && sItem.type !== 'masked') return sItem;
                const localMatch = items.find((l: PowerSlot) => l.expiresAt === sItem.expiresAt && l.type !== undefined && l.type !== 'masked')
                    || (items[idx]?.type !== undefined && items[idx]?.type !== 'masked' ? items[idx] : undefined);
                return localMatch ? { ...sItem, type: localMatch.type } : sItem;
            });
        }
    }

    // Assert: local player ('green') recovered their 'boost' power type!
    assert.equal(playerPowers.green[0].type, 'boost', 'local player must not lose their held power type');
    assert.equal(playerPowers.green[0].expiresAt, 1700001000);

    // Opponent ('red') remains sanitized / typeless
    assert.equal(playerPowers.red[0].type, undefined, 'opponent power type remains redacted');
});

test('Stealth AFK masking strips forfeitedWallets, kickedSeats, turnPhaseKind, and masks opponent AFK/kick state', () => {
    const rawState = {
        currentPlayer: 'yellow',
        turnPhaseKind: 'ai_roll',
        forfeitedWallets: ['0x2222222222222222222222222222222222222222'],
        kickedSeats: {
            yellow: { wallet: '0x2222222222222222222222222222222222222222', reason: 'afk_timeout', at: 1700000000 },
        },
        afkStats: {
            green: {
                mode: 'human',
                isAutoPlaying: false,
                consecutiveTurns: 0,
                totalTriggers: 1,
                afkTriggers: 1,
                isKicked: false,
            },
            yellow: {
                mode: 'kicked_smart_bot',
                isAutoPlaying: false,
                consecutiveTurns: 0,
                totalTriggers: 5,
                afkTriggers: 5,
                isKicked: true,
                kickReason: 'afk_limit_5',
            },
        },
    };

    // Viewer 'green' must NOT see yellow's kick/AFK status, forfeitedWallets, kickedSeats, or ai_roll
    const forGreen = sanitizeGameStateForWire(rawState, 'green');
    assert.equal('forfeitedWallets' in forGreen, false);
    assert.equal('kickedSeats' in forGreen, false);
    assert.equal(forGreen.turnPhaseKind, 'cast');
    assert.equal(forGreen.afkStats?.yellow?.isKicked, false);
    assert.equal(forGreen.afkStats?.yellow?.mode, 'human');
    assert.equal(forGreen.afkStats?.yellow?.afkTriggers, 0);
    assert.equal(forGreen.afkStats?.green?.afkTriggers, 1);

    // Viewer 'yellow' DOES see their own kick status so the persistent modal renders
    const forYellow = sanitizeGameStateForWire(rawState, 'yellow');
    assert.equal('forfeitedWallets' in forYellow, false);
    assert.equal(forYellow.afkStats?.yellow?.isKicked, true);
    assert.equal(forYellow.afkStats?.yellow?.kickReason, 'afk_limit_5');

    // Spectator sees neutral human mask for every seat
    const forSpec = sanitizeGameStateForWire(rawState);
    assert.equal(forSpec.afkStats?.yellow?.isKicked, false);
    assert.equal(forSpec.afkStats?.green?.afkTriggers, 0);
});

