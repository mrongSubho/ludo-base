import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SoundEngine } from '../lib/audio/SoundEngine';
import { SFX_CATALOG } from '../lib/audio/sfxCatalog';
import {
    computeMatchAudioMood,
    diffGameStateForAudio,
    emoteSoundIdFor,
} from '../lib/audio/boardAudioState';
import { INITIAL_GAME_STATE } from '../lib/gameLogic';
import type { AudioTheme, SoundId } from '../lib/audio/types';
import type { ColorCorner } from '../lib/boardLayout';
import type { GameState } from '../lib/types';

// ── Mock Web Audio Graph tracking every created node & disconnect() call ─────

interface TrackedNode {
    kind: 'osc' | 'src' | 'gain' | 'filter' | 'compressor';
    disconnected: boolean;
    onended?: (() => void) | null;
    startCount: number;
    stopCount: number;
}

function createMockAudioContext() {
    let timeSec = 1.0;
    const nodes: TrackedNode[] = [];
    let closed = false;

    const makeParam = (initial = 0) => ({
        value: initial,
        setValueAtTime: () => {},
        linearRampToValueAtTime: () => {},
        exponentialRampToValueAtTime: () => {},
        setTargetAtTime: () => {},
        cancelScheduledValues: () => {},
    });

    const track = (kind: TrackedNode['kind']): TrackedNode => {
        const rec: TrackedNode = { kind, disconnected: false, startCount: 0, stopCount: 0 };
        nodes.push(rec);
        return rec;
    };

    const ctx = {
        get currentTime() {
            return timeSec;
        },
        set currentTime(v: number) {
            timeSec = v;
        },
        sampleRate: 44100,
        state: 'running' as AudioContextState,
        destination: { connect: () => {}, disconnect: () => {} },
        resume: async () => {
            ctx.state = 'running';
        },
        suspend: async () => {
            ctx.state = 'suspended';
        },
        close: async () => {
            closed = true;
            ctx.state = 'closed';
        },
        createBuffer: (_ch: number, len: number) => ({
            duration: len / 44100,
            getChannelData: () => new Float32Array(len),
        }),
        createOscillator: () => {
            const rec = track('osc');
            const osc = {
                type: 'sine' as OscillatorType,
                frequency: makeParam(440),
                detune: makeParam(0),
                connect: () => {},
                disconnect: () => {
                    rec.disconnected = true;
                },
                start: () => {
                    rec.startCount++;
                },
                stop: () => {
                    rec.stopCount++;
                },
                set onended(fn: (() => void) | null) {
                    rec.onended = fn;
                },
                get onended() {
                    return rec.onended ?? null;
                },
            };
            return osc;
        },
        createBufferSource: () => {
            const rec = track('src');
            const src = {
                buffer: null as unknown,
                connect: () => {},
                disconnect: () => {
                    rec.disconnected = true;
                },
                start: () => {
                    rec.startCount++;
                },
                stop: () => {
                    rec.stopCount++;
                },
                set onended(fn: (() => void) | null) {
                    rec.onended = fn;
                },
                get onended() {
                    return rec.onended ?? null;
                },
            };
            return src;
        },
        createGain: () => {
            const rec = track('gain');
            const gainParam = makeParam(1);
            return {
                gain: gainParam,
                connect: () => {},
                disconnect: () => {
                    rec.disconnected = true;
                },
            };
        },
        createBiquadFilter: () => {
            const rec = track('filter');
            return {
                type: 'lowpass' as BiquadFilterType,
                frequency: makeParam(1000),
                Q: makeParam(1),
                connect: () => {},
                disconnect: () => {
                    rec.disconnected = true;
                },
            };
        },
        createDynamicsCompressor: () => {
            const rec = track('compressor');
            return {
                threshold: makeParam(-12),
                knee: makeParam(18),
                ratio: makeParam(4),
                attack: makeParam(0.004),
                release: makeParam(0.18),
                connect: () => {},
                disconnect: () => {
                    rec.disconnected = true;
                },
            };
        },
    };

    return {
        ctx: ctx as unknown as AudioContext,
        nodes,
        isClosed: () => closed,
        advanceTime: (dt: number) => {
            timeSec += dt;
        },
        flushEnded: () => {
            for (const n of nodes) {
                if ((n.kind === 'osc' || n.kind === 'src') && n.onended) {
                    n.onended();
                }
            }
        },
    };
}

const TEST_CC: ColorCorner = { green: 'BL', red: 'BR', yellow: 'TR', blue: 'TL' };

function cloneState(overrides: Partial<GameState> = {}): GameState {
    return {
        ...JSON.parse(JSON.stringify(INITIAL_GAME_STATE)),
        playerCount: '1v1',
        initialBoardConfig: { players: [], colorCorner: TEST_CC },
        ...overrides,
    };
}

test('SoundEngine: creates strictly one AudioContext and honors REA-12 teardown', () => {
    let creations = 0;
    let mock = createMockAudioContext();
    const engine = new SoundEngine({
        createContext: () => {
            creations++;
            mock = createMockAudioContext();
            return mock.ctx;
        },
    });

    engine.updatePrefs({ sfx: true, music: false, sfxVolume: 80, musicVolume: 70, theme: '3077' });

    assert.equal(engine.play('ui_click'), true);
    assert.equal(engine.play('power_nuke'), true);
    assert.equal(engine.play('capture_kick'), true);
    assert.equal(creations, 1, 'must reuse single shared AudioContext across calls');

    const sourcesBeforeFlush = mock.nodes.filter((n) => n.kind === 'osc' || n.kind === 'src');
    assert.ok(sourcesBeforeFlush.length > 6, 'layered recipes must create oscillator/noise voices');
    assert.ok(sourcesBeforeFlush.every((n) => typeof n.onended === 'function'), 'every voice must bind onended');

    mock.flushEnded();
    // Every transient oscillator, buffer source, and transient gain/filter must disconnect
    const nonBusNodes = mock.nodes.slice(7); // skip 7 persistent nodes: 5 GainNodes + musicFilter + compressor
    assert.ok(
        nonBusNodes.every((n) => n.disconnected),
        'REA-12: every transient Web Audio node must disconnect when its voice ends',
    );
    engine.dispose();
    assert.equal(mock.isClosed(), true);
});

test('SFX_CATALOG: every sound renders across all 3 themes without throwing', () => {
    const mock = createMockAudioContext();
    const engine = new SoundEngine({ createContext: () => mock.ctx });
    const themes: AudioTheme[] = ['3077', 'retro', 'light'];
    const ids = Object.keys(SFX_CATALOG) as SoundId[];

    assert.ok(ids.length >= 65, `expected rich catalog (>=65 sounds), got ${ids.length}`);

    for (const theme of themes) {
        engine.updatePrefs({ theme, sfx: true, sfxVolume: 100, music: false });
        for (const id of ids) {
            const ok = engine.play(id, {
                force: true,
                step: 2,
                totalSteps: 6,
                tierIndex: 5,
                streak: 2,
                finishCount: 3,
                rarity: 'nuke',
                boosted: true,
                urgentLevel: 2,
                theme,
            });
            assert.equal(ok, true, `expected ${id} under theme ${theme} to render`);
        }
    }
    mock.flushEnded();
    engine.dispose();
});

test('SoundEngine: mute toggles, volume sliders, cooldowns, and nested modal ducking behave accurately', () => {
    const mock = createMockAudioContext();
    const engine = new SoundEngine({ createContext: () => mock.ctx });

    engine.updatePrefs({ sfx: false, sfxVolume: 80 });
    assert.equal(engine.play('ui_click'), false, 'muted sfx blocks normal play');
    assert.equal(engine.play('pref_toggle_on', { force: true }), true, 'force bypasses mute for toggle preview');

    engine.updatePrefs({ sfx: true, sfxVolume: 0 });
    assert.equal(engine.play('ui_click'), false, '0% volume blocks sfx');

    engine.updatePrefs({ sfx: true, sfxVolume: 80 });
    assert.equal(engine.play('ui_hover'), true);
    assert.equal(engine.play('ui_hover'), false, 'hover cooldown prevents buzz on rapid calls');

    engine.pushModalDuck();
    engine.pushModalDuck();
    assert.equal(engine.getModalDuckCount(), 2);
    engine.popModalDuck();
    assert.equal(engine.getModalDuckCount(), 1, 'nested modal closes keep ducking active until last closes');
    engine.popModalDuck();
    assert.equal(engine.getModalDuckCount(), 0);
    engine.dispose();
});

test('MusicDirector: 3 theme tracks schedule procedural patterns across lobby, queue, and match crunch heartbeat', () => {
    const mock = createMockAudioContext();
    const engine = new SoundEngine({ createContext: () => mock.ctx });
    engine.unlock();

    const themes: AudioTheme[] = ['3077', 'retro', 'light'];
    for (const theme of themes) {
        engine.updatePrefs({ theme, music: true, musicVolume: 75, sfx: true });
        engine.setAppScene('dashboard');
        assert.equal(engine.getMusicDirectorState().scene, 'lobby');
        assert.equal(engine.getMusicDirectorState().theme, theme);

        engine.pushQueueing();
        assert.equal(engine.getMusicDirectorState().scene, 'queueing');
        engine.popQueueing();
        assert.equal(engine.getMusicDirectorState().scene, 'lobby');

        engine.setAppScene('game');
        engine.setMatchMood('match_crunch', 0.9);
        assert.equal(engine.getMusicDirectorState().scene, 'match_crunch');
        assert.equal(engine.getMusicDirectorState().urgency, 0.9);
        mock.advanceTime(0.35);
    }

    assert.ok(mock.nodes.filter((n) => n.kind === 'osc').length > 0, 'MusicDirector must schedule oscillators');
    mock.flushEnded();
    engine.dispose();
});

test('computeMatchAudioMood: triggers match_crunch with escalating urgency when 1 token remains near finish', () => {
    // 1v1 opening -> calm
    const calm = cloneState({ playerCount: '1v1' });
    assert.equal(computeMatchAudioMood(calm, '1v1', TEST_CC).scene, 'match_calm');

    // 1v1 mid-game kicks -> heat
    const heat = cloneState({
        playerCount: '1v1',
        matchStats: {
            green: { kicks: 1, gotKicked: 0 },
            red: { kicks: 0, gotKicked: 0 },
            yellow: { kicks: 0, gotKicked: 1 },
            blue: { kicks: 0, gotKicked: 0 },
        },
    });
    assert.equal(computeMatchAudioMood(heat, '1v1', TEST_CC).scene, 'match_heat');

    // 1v1 green has 3 tokens at 57 and 1 token at 54 (3 steps from finish) -> crunch
    const crunch1v1 = cloneState({
        playerCount: '1v1',
        positions: {
            green: [57, 57, 57, 54],
            red: [-1, -1, -1, -1],
            yellow: [10, 12, -1, -1],
            blue: [-1, -1, -1, -1],
        },
    });
    const m1 = computeMatchAudioMood(crunch1v1, '1v1', TEST_CC);
    assert.equal(m1.scene, 'match_crunch');
    assert.ok(m1.urgency >= 0.75, `expected high urgency at pos 54, got ${m1.urgency}`);

    // 2v2 Green+Blue have 7 tokens at 57 and 1 token at 53 (4 steps away) -> crunch
    const crunch2v2 = cloneState({
        playerCount: '2v2',
        positions: {
            green: [57, 57, 57, 57],
            blue: [57, 57, 57, 53],
            red: [1, 2, -1, -1],
            yellow: [5, -1, -1, -1],
        },
    });
    const m2 = computeMatchAudioMood(crunch2v2, '2v2', TEST_CC);
    assert.equal(m2.scene, 'match_crunch');
    assert.ok(m2.urgency > 0.5);

    // Finished -> result
    const done = cloneState({ winner: 'green', status: 'finished' });
    assert.equal(computeMatchAudioMood(done, '1v1', TEST_CC).scene, 'result');
});

test('diffGameStateForAudio: distinguishes kick vs got-kicked, sixes, bust, home lane, finish, timer, and victory/defeat', () => {
    const ctx = {
        myColor: 'green' as const,
        playerCount: '2v2' as const,
        colorCorner: TEST_CC,
    };

    // 1. Rolled a 6 (streak 2)
    const s0 = cloneState({ playerCount: '2v2', isRolling: true, consecutiveSixes: 1 });
    const s1 = cloneState({ playerCount: '2v2', isRolling: false, diceValue: 6, consecutiveSixes: 2 });
    const evSix = diffGameStateForAudio(s0, s1, ctx);
    assert.ok(evSix.some((e) => e.id === 'dice_six' && e.opts?.streak === 2));

    // 2. Kick opponent (yellow drops from 15 -> -1) vs Got Kicked (green drops from 15 -> -1)
    const baseBoard = cloneState({
        playerCount: '2v2',
        positions: { green: [15, -1, -1, -1], blue: [20, -1, -1, -1], red: [25, -1, -1, -1], yellow: [18, -1, -1, -1] },
    });
    const iKicked = cloneState({
        playerCount: '2v2',
        positions: { green: [18, -1, -1, -1], blue: [20, -1, -1, -1], red: [25, -1, -1, -1], yellow: [-1, -1, -1, -1] },
    });
    assert.ok(diffGameStateForAudio(baseBoard, iKicked, ctx).some((e) => e.id === 'capture_kick'));

    const gotKicked = cloneState({
        playerCount: '2v2',
        positions: { green: [-1, -1, -1, -1], blue: [20, -1, -1, -1], red: [15, -1, -1, -1], yellow: [18, -1, -1, -1] },
    });
    assert.ok(diffGameStateForAudio(baseBoard, gotKicked, ctx).some((e) => e.id === 'capture_got_kicked'));

    const mateKicked = cloneState({
        playerCount: '2v2',
        positions: { green: [15, -1, -1, -1], blue: [-1, -1, -1, -1], red: [20, -1, -1, -1], yellow: [18, -1, -1, -1] },
    });
    assert.ok(diffGameStateForAudio(baseBoard, mateKicked, ctx).some((e) => e.id === 'capture_teammate_kicked'));

    // 3. Home lane & Finish
    const preFinish = cloneState({
        playerCount: '2v2',
        positions: { green: [55, 57, -1, -1], blue: [-1, -1, -1, -1], red: [-1, -1, -1, -1], yellow: [-1, -1, -1, -1] },
    });
    const postFinish = cloneState({
        playerCount: '2v2',
        positions: { green: [57, 57, -1, -1], blue: [-1, -1, -1, -1], red: [-1, -1, -1, -1], yellow: [-1, -1, -1, -1] },
    });
    const evFin = diffGameStateForAudio(preFinish, postFinish, ctx);
    assert.ok(evFin.some((e) => e.id === 'token_finish_home' && e.opts?.finishCount === 2));

    // 4. Urgent timer + Win/Defeat
    const t5 = cloneState({ currentPlayer: 'green', timeLeft: 4 });
    const t3 = cloneState({ currentPlayer: 'green', timeLeft: 3 });
    assert.ok(diffGameStateForAudio(t5, t3, ctx).some((e) => e.id === 'timer_urgent' && e.opts?.urgentLevel === 3));

    const win2v2 = cloneState({ playerCount: '2v2', winner: 'Team 1', status: 'finished' });
    assert.ok(diffGameStateForAudio(t3, win2v2, ctx).some((e) => e.id === 'match_victory'));

    const lose2v2 = cloneState({ playerCount: '2v2', winner: 'Team 2', status: 'finished' });
    assert.ok(diffGameStateForAudio(t3, lose2v2, ctx).some((e) => e.id === 'match_defeat'));

    // 5. Cyber-Orb emote mapping
    assert.equal(emoteSoundIdFor('custom', '/emotes/cyber-orb/orb-laser-eyes.svg'), 'emote_laser');
    assert.equal(emoteSoundIdFor('custom', '/emotes/cyber-orb/orb-wave.svg'), 'emote_sonar');
    assert.equal(emoteSoundIdFor('nice'), 'emote_preset');
});

test('Audio wiring invariants: volume sliders, shared engine, and zero rogue AudioContext in EntryFeeKnob', () => {
    const read = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');

    const prefKeys = read('lib/preferencesUtils.ts');
    assert.match(prefKeys, /ludo-sfx-vol/);
    assert.match(prefKeys, /ludo-music-vol/);

    const prefsHook = read('hooks/usePreferences.ts');
    assert.match(prefsHook, /sfxVolume/);
    assert.match(prefsHook, /musicVolume/);

    const settingsSrc = read('app/components/SettingsPanel.tsx');
    assert.match(settingsSrc, /SFX Volume/);
    assert.match(settingsSrc, /Music Volume/);

    const knobSrc = read('app/components/EntryFeeKnob.tsx');
    assert.doesNotMatch(knobSrc, /sharedAudioCtx/);
    assert.match(knobSrc, /getSoundEngine/);
});
