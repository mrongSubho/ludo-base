import {
    playDrumHat,
    playDrumKick,
    playDrumSnareClap,
    playElectricPiano,
    playFmBell,
    playHeartbeatPulse,
    playMalletNote,
    playNoiseBurst,
    playPercAccent,
    playReeseBass,
    playShaker,
    playSynthPad,
    playSynthTom,
    playTone,
    playWarmVoice,
} from './synthPrimitives';
import type { AudioTheme, MusicScene } from './types';

/**
 * 14 Hz Binaural Beats Hypnosis / Flow-State Entrainment Constants
 * (Low-Beta / SMR 14.0 Hz sensorimotor rhythm for calm hyper-focus).
 *
 * Left ear = carrierRoot - 7.0 Hz (pan = -1.0)
 * Right ear = carrierRoot + 7.0 Hz (pan = +1.0)
 * Perceived pitch = exact carrierRoot (100% in key with the active theme).
 */
export const BINAURAL_BEAT_HZ = 14.0;
export const BINAURAL_HALF_OFFSET_HZ = BINAURAL_BEAT_HZ * 0.5; // 7.0 Hz

export const BINAURAL_CARRIER_ROOTS: Record<AudioTheme, number> = {
    '3077': 174.61, // F3 (F Minor / Phrygian tonic)
    retro: 130.81,  // C3 (C Minor / Eb Major tonic)
    light: 146.83,  // D3 (D Major 9 / Bm11 tonic)
};

export interface BinauralState {
    active: boolean;
    beatHz: number;
    carrierHz: number;
    leftHz: number;
    rightHz: number;
}

interface ActiveBinauralGraph {
    leftOsc: OscillatorNode;
    rightOsc: OscillatorNode;
    shimmerOsc: OscillatorNode;
    lfoOsc: OscillatorNode;
    allNodes: AudioNode[];
}

// ─── Theme 1: 3077 — Cyberpunk Dark-Synth / Phonk-Industrial (136 -> 142 BPM, F Minor / Phrygian) ──
const SCORE_3077 = {
    lobbyBpm: 136,
    matchBpm: 142,
    // 8-bar F Phrygian / Dark Minor bass roots: F1, Gb1, Ab1, F1, Db1, Eb1, F1, C2
    bassRoots: [43.65, 46.25, 51.91, 43.65, 34.65, 38.89, 43.65, 65.41] as const,
    powerStabs: [
        [174.61, 207.65, 261.63, 349.23], // Fm
        [185.0, 233.08, 277.18, 369.99],  // Gbmaj7 (Phrygian bII)
        [207.65, 261.63, 311.13, 392.0],  // Abmaj7
        [174.61, 233.08, 261.63, 349.23], // Fm(add4)
        [138.59, 174.61, 207.65, 261.63], // Dbmaj7
        [155.56, 196.0, 233.08, 293.66],  // Eb6
        [174.61, 207.65, 261.63, 311.13], // Fm7
        [196.0, 246.94, 293.66, 349.23],  // Gdim/C7alt tension
    ] as const,
    // 16-step hypnotic cyber-acid arpeggiator patterns (cycled across bars)
    acidArps: [
        [349.23, 415.3, 523.25, 415.3, 698.46, 523.25, 415.3, 349.23, 370.0, 415.3, 523.25, 698.46, 622.25, 523.25, 415.3, 370.0],
        [370.0, 466.16, 554.37, 466.16, 739.99, 554.37, 466.16, 370.0, 349.23, 466.16, 554.37, 739.99, 698.46, 554.37, 466.16, 349.23],
        [415.3, 523.25, 622.25, 523.25, 830.61, 622.25, 523.25, 415.3, 466.16, 523.25, 622.25, 783.99, 698.46, 622.25, 523.25, 415.3],
        [349.23, 523.25, 698.46, 622.25, 523.25, 415.3, 370.0, 349.23, 523.25, 698.46, 830.61, 698.46, 622.25, 523.25, 415.3, 370.0],
    ] as const,
    // Syncopated phonk/cyber metallic cowbell/sonar hook (steps 0..15, 0 = rest)
    phonkBellSteps: [0, 0, 0, 698.46, 0, 0, 830.61, 0, 0, 0, 739.99, 0, 0, 698.46, 0, 523.25] as const,
};

// ─── Theme 2: Retro — 80s Outrun Synthwave / Neon Arcade (102 -> 108 BPM, C Minor / Eb Major) ──
const SCORE_RETRO = {
    lobbyBpm: 102,
    matchBpm: 108,
    // 8-bar Outrun progression: Cm9, Abmaj7, Ebmaj7, Bb6, Fm9, Abmaj7, G7sus4, G7
    bassRoots: [65.41, 51.91, 77.78, 58.27, 43.65, 51.91, 49.0, 49.0] as const,
    padChords: [
        [261.63, 311.13, 392.0, 466.16, 587.33], // Cm9
        [207.65, 261.63, 311.13, 392.0, 466.16], // Abmaj9
        [311.13, 392.0, 466.16, 587.33],         // Ebmaj7
        [233.08, 293.66, 349.23, 392.0],         // Bb6
        [174.61, 207.65, 261.63, 311.13, 392.0], // Fm9
        [207.65, 261.63, 311.13, 392.0],         // Abmaj7
        [196.0, 261.63, 293.66, 349.23],         // G7sus4
        [196.0, 246.94, 293.66, 349.23],         // G7
    ] as const,
    // 8 bars × 8 eighth-note FM Bell / Synthwave melody hooks (0 = rest)
    fmLeads: [
        [523.25, 0, 622.25, 783.99, 0, 698.46, 622.25, 587.33],
        [622.25, 0, 783.99, 932.33, 0, 783.99, 698.46, 622.25],
        [622.25, 783.99, 1046.5, 0, 932.33, 783.99, 698.46, 622.25],
        [587.33, 0, 698.46, 783.99, 698.46, 587.33, 466.16, 0],
        [523.25, 622.25, 698.46, 0, 783.99, 698.46, 622.25, 523.25],
        [622.25, 783.99, 932.33, 0, 1046.5, 932.33, 783.99, 622.25],
        [587.33, 698.46, 783.99, 932.33, 0, 783.99, 698.46, 587.33],
        [587.33, 783.99, 987.77, 1174.66, 987.77, 783.99, 698.46, 587.33],
    ] as const,
};

// ─── Theme 3: Light (Daybreak) — Monte Carlo Bossa-Lounge / Tropical Marimba Jazz (94 -> 100 BPM) ──
const SCORE_LIGHT = {
    lobbyBpm: 94,
    matchBpm: 100,
    // 8-bar Jazz Lounge progression: Dmaj9, Bm11, Em9, A13sus4, F#m7, Bm9, Gmaj9, A13
    bassRoots: [73.42, 61.74, 82.41, 55.0, 92.5, 61.74, 98.0, 55.0] as const,
    bassFifths: [110.0, 92.5, 123.47, 82.41, 138.59, 92.5, 146.83, 82.41] as const,
    rhodesChords: [
        [293.66, 369.99, 440.0, 554.37, 659.25], // Dmaj9
        [246.94, 293.66, 369.99, 440.0, 523.25], // Bm11
        [329.63, 392.0, 493.88, 587.33, 739.99], // Em9
        [220.0, 293.66, 329.63, 392.0, 554.37],  // A13sus4
        [277.18, 329.63, 369.99, 493.88],        // F#m7
        [246.94, 293.66, 369.99, 440.0, 554.37], // Bm9
        [293.66, 392.0, 493.88, 587.33, 659.25], // Gmaj9
        [220.0, 277.18, 329.63, 392.0, 554.37],  // A13
    ] as const,
    // 3-2 Son/Bossa Clave steps inside a 16-step bar: 0, 3, 6, 10, 12
    bossaClaveSteps: new Set([0, 3, 6, 10, 12]),
    // Syncopated Bossa Nova Rhodes comping steps
    bossaCompSteps: new Set([0, 3, 6, 10, 14]),
    // 8 bars × 16 sixteenth-note Tropical Marimba melodies (0 = rest)
    marimbaMelodies: [
        [587.33, 0, 659.25, 739.99, 0, 880.0, 739.99, 0, 659.25, 0, 587.33, 440.0, 0, 587.33, 659.25, 0],
        [493.88, 0, 587.33, 659.25, 0, 739.99, 659.25, 0, 587.33, 0, 493.88, 369.99, 0, 493.88, 587.33, 0],
        [659.25, 0, 739.99, 783.99, 0, 987.77, 880.0, 0, 783.99, 0, 739.99, 659.25, 0, 587.33, 659.25, 0],
        [659.25, 739.99, 880.0, 0, 739.99, 659.25, 587.33, 0, 554.37, 0, 659.25, 739.99, 0, 659.25, 554.37, 0],
        [739.99, 0, 880.0, 987.77, 0, 1108.73, 987.77, 0, 880.0, 0, 739.99, 659.25, 0, 739.99, 880.0, 0],
        [587.33, 0, 739.99, 880.0, 0, 987.77, 880.0, 0, 739.99, 0, 659.25, 587.33, 0, 493.88, 587.33, 0],
        [783.99, 0, 880.0, 987.77, 0, 1174.66, 987.77, 0, 880.0, 0, 783.99, 659.25, 0, 783.99, 880.0, 0],
        [880.0, 739.99, 659.25, 587.33, 0, 659.25, 739.99, 880.0, 0, 987.77, 880.0, 739.99, 659.25, 587.33, 554.37, 0],
    ] as const,
};

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_SEC = 0.14;
const STEPS_PER_BAR = 16;
const TOTAL_BARS = 8;
const TOTAL_STEPS = STEPS_PER_BAR * TOTAL_BARS; // 128 steps per loop

function safeDisconnectNode(node: AudioNode | null | undefined): void {
    if (!node) return;
    try {
        node.disconnect();
    } catch {
        /* already disconnected */
    }
}

export class MusicDirector {
    private theme: AudioTheme = '3077';
    private scene: MusicScene = 'silent';
    private urgency = 0;
    private step = 0;
    private nextNoteTime = 0;
    private timerId: ReturnType<typeof setInterval> | null = null;
    private nextHeartbeatTime = 0;
    private heartbeatTimerId: ReturnType<typeof setInterval> | null = null;
    private isPlaying = false;
    private binauralGraph: ActiveBinauralGraph | null = null;

    private getCtx: () => AudioContext | null;
    private getDrumDest: () => AudioNode | null;
    private getMelodyDest: () => AudioNode | null;
    private getHeartbeatDest: () => AudioNode | null;
    private getBinauralDest: () => AudioNode | null;
    private onFilterTarget: (cutoffHz: number, q: number) => void;

    constructor(deps: {
        getCtx: () => AudioContext | null;
        getMusicDest: () => AudioNode | null;
        getDrumDest?: () => AudioNode | null;
        getMelodyDest?: () => AudioNode | null;
        getHeartbeatDest: () => AudioNode | null;
        getBinauralDest?: () => AudioNode | null;
        onFilterTarget: (cutoffHz: number, q: number) => void;
    }) {
        this.getCtx = deps.getCtx;
        this.getDrumDest = deps.getDrumDest ?? deps.getMusicDest;
        this.getMelodyDest = deps.getMelodyDest ?? deps.getMusicDest;
        this.getHeartbeatDest = deps.getHeartbeatDest;
        this.getBinauralDest = deps.getBinauralDest ?? deps.getMusicDest;
        this.onFilterTarget = deps.onFilterTarget;
    }

    public getBinauralState(): BinauralState {
        const carrierHz = BINAURAL_CARRIER_ROOTS[this.theme];
        const leftHz = Number((carrierHz - BINAURAL_HALF_OFFSET_HZ).toFixed(2));
        const rightHz = Number((carrierHz + BINAURAL_HALF_OFFSET_HZ).toFixed(2));
        return {
            active: this.isPlaying && this.scene !== 'silent' && this.binauralGraph !== null,
            beatHz: BINAURAL_BEAT_HZ,
            carrierHz,
            leftHz,
            rightHz,
        };
    }

    public getState(): {
        theme: AudioTheme;
        scene: MusicScene;
        urgency: number;
        isPlaying: boolean;
        step: number;
        bpm: number;
        binaural: BinauralState;
    } {
        return {
            theme: this.theme,
            scene: this.scene,
            urgency: this.urgency,
            isPlaying: this.isPlaying,
            step: this.step,
            bpm: this.currentBpm(),
            binaural: this.getBinauralState(),
        };
    }

    public setTheme(next: AudioTheme): void {
        if (this.theme === next) return;
        this.theme = next;
        this.retuneBinaural();
    }

    public setScene(next: MusicScene, urgency = 0): void {
        const clampedUrgency = Math.max(0, Math.min(1, urgency));
        const sceneChanged = this.scene !== next;
        this.scene = next;
        this.urgency = clampedUrgency;

        if (next === 'silent') {
            this.stop();
            return;
        }

        this.updateFilterForScene();
        if (!this.isPlaying) {
            this.start();
        } else {
            this.ensureBinauralRunning();
            if (sceneChanged && next === 'match_crunch') {
                const ctx = this.getCtx();
                if (ctx) this.nextHeartbeatTime = ctx.currentTime + 0.04;
            }
        }
    }

    public start(): void {
        const ctx = this.getCtx();
        if (!ctx || this.scene === 'silent') return;
        if (this.isPlaying) return;

        this.isPlaying = true;
        this.nextNoteTime = ctx.currentTime + 0.025;
        this.nextHeartbeatTime = ctx.currentTime + 0.035;
        this.updateFilterForScene();
        this.ensureBinauralRunning();

        if (!this.timerId) {
            this.timerId = setInterval(() => this.schedulerTick(), LOOKAHEAD_MS);
        }
        if (!this.heartbeatTimerId) {
            this.heartbeatTimerId = setInterval(() => this.heartbeatTick(), 40);
        }
        this.schedulerTick();
        this.heartbeatTick();
    }

    public stop(): void {
        this.isPlaying = false;
        this.stopBinaural();
        if (this.timerId) {
            clearInterval(this.timerId);
            this.timerId = null;
        }
        if (this.heartbeatTimerId) {
            clearInterval(this.heartbeatTimerId);
            this.heartbeatTimerId = null;
        }
    }

    // ─── 14 Hz Binaural Beats Hypnosis Engine ─────────────────────────────────

    private ensureBinauralRunning(): void {
        if (this.binauralGraph || !this.isPlaying || this.scene === 'silent') return;
        const ctx = this.getCtx();
        const dest = this.getBinauralDest();
        if (!ctx || !dest) return;

        const now = ctx.currentTime;
        const carrierHz = BINAURAL_CARRIER_ROOTS[this.theme];
        const leftHz = carrierHz - BINAURAL_HALF_OFFSET_HZ;
        const rightHz = carrierHz + BINAURAL_HALF_OFFSET_HZ;

        const leftOsc = ctx.createOscillator();
        const rightOsc = ctx.createOscillator();
        const shimmerOsc = ctx.createOscillator();
        const lfoOsc = ctx.createOscillator();

        const leftGain = ctx.createGain();
        const rightGain = ctx.createGain();
        const shimmerGain = ctx.createGain();
        const lfoDepthGain = ctx.createGain();

        const allNodes: AudioNode[] = [
            leftOsc,
            rightOsc,
            shimmerOsc,
            lfoOsc,
            leftGain,
            rightGain,
            shimmerGain,
            lfoDepthGain,
        ];

        leftOsc.type = 'sine';
        rightOsc.type = 'sine';
        shimmerOsc.type = 'triangle';
        lfoOsc.type = 'sine';

        leftOsc.frequency.setValueAtTime(leftHz, now);
        rightOsc.frequency.setValueAtTime(rightHz, now);
        shimmerOsc.frequency.setValueAtTime(carrierHz * 2, now);
        lfoOsc.frequency.setValueAtTime(BINAURAL_BEAT_HZ, now);

        // Smooth fade-in for pure dichotic 14 Hz carrier pair
        leftGain.gain.setValueAtTime(0.0005, now);
        leftGain.gain.linearRampToValueAtTime(0.055, now + 0.18);
        rightGain.gain.setValueAtTime(0.0005, now);
        rightGain.gain.linearRampToValueAtTime(0.055, now + 0.18);

        // Subtle 14 Hz AM-modulated harmonic pad so speakers also transmit the 14 Hz hypnosis pulse
        shimmerGain.gain.setValueAtTime(0.022, now);
        lfoDepthGain.gain.setValueAtTime(0.014, now);

        leftOsc.connect(leftGain);
        rightOsc.connect(rightGain);

        if (typeof ctx.createStereoPanner === 'function') {
            const panL = ctx.createStereoPanner();
            const panR = ctx.createStereoPanner();
            panL.pan.setValueAtTime(-1.0, now);
            panR.pan.setValueAtTime(1.0, now);
            leftGain.connect(panL);
            rightGain.connect(panR);
            panL.connect(dest);
            panR.connect(dest);
            allNodes.push(panL, panR);
        } else {
            leftGain.connect(dest);
            rightGain.connect(dest);
        }

        if (typeof ctx.createBiquadFilter === 'function') {
            const shimmerFilter = ctx.createBiquadFilter();
            shimmerFilter.type = 'lowpass';
            shimmerFilter.frequency.setValueAtTime(420, now);
            shimmerFilter.Q.setValueAtTime(1.2, now);
            shimmerOsc.connect(shimmerFilter);
            shimmerFilter.connect(shimmerGain);
            allNodes.push(shimmerFilter);
        } else {
            shimmerOsc.connect(shimmerGain);
        }

        lfoOsc.connect(lfoDepthGain);
        try {
            lfoDepthGain.connect(shimmerGain.gain as unknown as AudioNode);
        } catch {
            /* fallback if mock environment does not accept AudioParam connect */
        }
        shimmerGain.connect(dest);

        let ended = 0;
        const finishShared = () => {
            if (++ended >= 4) {
                for (const n of allNodes) safeDisconnectNode(n);
            }
        };
        leftOsc.onended = () => {
            safeDisconnectNode(leftOsc);
            finishShared();
        };
        rightOsc.onended = () => {
            safeDisconnectNode(rightOsc);
            finishShared();
        };
        shimmerOsc.onended = () => {
            safeDisconnectNode(shimmerOsc);
            finishShared();
        };
        lfoOsc.onended = () => {
            safeDisconnectNode(lfoOsc);
            finishShared();
        };

        leftOsc.start(now);
        rightOsc.start(now);
        shimmerOsc.start(now);
        lfoOsc.start(now);

        this.binauralGraph = { leftOsc, rightOsc, shimmerOsc, lfoOsc, allNodes };
    }

    private retuneBinaural(): void {
        if (!this.binauralGraph) return;
        const ctx = this.getCtx();
        if (!ctx) return;

        const now = ctx.currentTime;
        const carrierHz = BINAURAL_CARRIER_ROOTS[this.theme];
        const leftHz = carrierHz - BINAURAL_HALF_OFFSET_HZ;
        const rightHz = carrierHz + BINAURAL_HALF_OFFSET_HZ;

        const setFreqSmooth = (osc: OscillatorNode, hz: number) => {
            try {
                if (typeof osc.frequency.setTargetAtTime === 'function') {
                    osc.frequency.setTargetAtTime(hz, now, 0.08);
                } else {
                    osc.frequency.setValueAtTime(hz, now);
                }
            } catch {
                osc.frequency.value = hz;
            }
        };

        setFreqSmooth(this.binauralGraph.leftOsc, leftHz);
        setFreqSmooth(this.binauralGraph.rightOsc, rightHz);
        setFreqSmooth(this.binauralGraph.shimmerOsc, carrierHz * 2);
    }

    private stopBinaural(): void {
        if (!this.binauralGraph) return;
        const graph = this.binauralGraph;
        this.binauralGraph = null;

        const oscs = [graph.leftOsc, graph.rightOsc, graph.shimmerOsc, graph.lfoOsc];
        for (const osc of oscs) {
            try {
                osc.stop();
            } catch {
                /* already stopped */
            }
        }
        for (const n of graph.allNodes) {
            safeDisconnectNode(n);
        }
    }

    // ─── Step & Heartbeat Schedulers ──────────────────────────────────────────

    /** Exposed for deterministic unit testing and manual lookahead pumping. */
    public schedulerTick(): number {
        if (!this.isPlaying || this.scene === 'silent') return 0;
        const ctx = this.getCtx();
        const drumDest = this.getDrumDest();
        const melodyDest = this.getMelodyDest();
        if (!ctx || !drumDest || !melodyDest) return 0;
        if (ctx.state === 'suspended') return 0;

        let scheduled = 0;
        if (this.nextNoteTime < ctx.currentTime - 0.5) {
            this.nextNoteTime = ctx.currentTime + 0.02;
        }

        while (this.nextNoteTime < ctx.currentTime + SCHEDULE_AHEAD_SEC) {
            this.scheduleStep(ctx, drumDest, melodyDest, this.step, this.nextNoteTime);
            const stepDur = this.stepDurationSec();
            this.nextNoteTime += stepDur;
            this.step = (this.step + 1) % TOTAL_STEPS;
            scheduled++;
        }
        return scheduled;
    }

    public heartbeatTick(): number {
        if (!this.isPlaying || this.scene !== 'match_crunch') return 0;
        const ctx = this.getCtx();
        const dest = this.getHeartbeatDest();
        if (!ctx || !dest || ctx.state === 'suspended') return 0;

        if (this.nextHeartbeatTime < ctx.currentTime - 0.8) {
            this.nextHeartbeatTime = ctx.currentTime + 0.03;
        }

        let fired = 0;
        while (this.nextHeartbeatTime < ctx.currentTime + 0.12) {
            const offset = Math.max(0, this.nextHeartbeatTime - ctx.currentTime);
            const beatBpm = 88 + this.urgency * 36; // 88..124 BPM intense crunch heartbeat
            if (offset <= 0.045) {
                playHeartbeatPulse(ctx, dest, this.urgency);
                fired++;
            }
            this.nextHeartbeatTime += 60 / beatBpm;
            if (offset > 0.045) break;
        }
        return fired;
    }

    private currentBpm(): number {
        const isMatch =
            this.scene === 'match_calm' ||
            this.scene === 'match_heat' ||
            this.scene === 'match_crunch';
        let baseBpm: number;
        if (this.theme === '3077') {
            baseBpm = isMatch ? SCORE_3077.matchBpm : SCORE_3077.lobbyBpm;
        } else if (this.theme === 'retro') {
            baseBpm = isMatch ? SCORE_RETRO.matchBpm : SCORE_RETRO.lobbyBpm;
        } else {
            baseBpm = isMatch ? SCORE_LIGHT.matchBpm : SCORE_LIGHT.lobbyBpm;
        }
        return this.scene === 'queueing' ? baseBpm + 6 : baseBpm;
    }

    private stepDurationSec(): number {
        return 60 / this.currentBpm() / 4; // 16th-note step
    }

    private updateFilterForScene(): void {
        if (this.scene === 'match_crunch') {
            this.onFilterTarget(2600, 1.3);
        } else if (this.scene === 'match_calm') {
            this.onFilterTarget(7500, 0.8);
        } else if (this.scene === 'result') {
            this.onFilterTarget(4200, 0.7);
        } else {
            this.onFilterTarget(11500, 0.7);
        }
    }

    private scheduleStep(
        ctx: AudioContext,
        drumDest: AudioNode,
        melodyDest: AudioNode,
        stepIndex: number,
        whenSec: number,
    ): void {
        const bar = Math.floor(stepIndex / STEPS_PER_BAR) % TOTAL_BARS;
        const stepInBar = stepIndex % STEPS_PER_BAR;
        const offset = Math.max(0, whenSec - ctx.currentTime);
        const stepDur = this.stepDurationSec();

        if (this.theme === '3077') {
            this.schedule3077Step(ctx, drumDest, melodyDest, bar, stepInBar, offset, stepDur);
        } else if (this.theme === 'retro') {
            this.scheduleRetroStep(ctx, drumDest, melodyDest, bar, stepInBar, offset, stepDur);
        } else {
            this.scheduleLightStep(ctx, drumDest, melodyDest, bar, stepInBar, offset, stepDur);
        }
    }

    // ─── Engine 1: 3077 Cyberpunk Dark-Synth / Phonk-Industrial Breakbeat ─────

    private schedule3077Step(
        ctx: AudioContext,
        drumDest: AudioNode,
        melodyDest: AudioNode,
        bar: number,
        stepInBar: number,
        offset: number,
        stepDur: number,
    ): void {
        const isCalm = this.scene === 'match_calm';
        const isHeat = this.scene === 'match_heat';
        const isCrunch = this.scene === 'match_crunch';
        const isQueue = this.scene === 'queueing';
        const isResult = this.scene === 'result';

        const root = SCORE_3077.bassRoots[bar];
        const stabChord = SCORE_3077.powerStabs[bar];
        const arpSeq = SCORE_3077.acidArps[bar % SCORE_3077.acidArps.length];

        if (isResult) {
            if (stepInBar === 0) {
                playSynthPad(ctx, melodyDest, stabChord, {
                    startOffset: offset,
                    duration: stepDur * 14,
                    gain: 0.08,
                    filterFreq: 2400,
                    filterFreqEnd: 1100,
                });
            }
            return;
        }

        // 1. Syncopated Breakbeat Drums (Kick on 0, 6, 10; Snare on 4, 12; Rapid Glitch Hat Rolls on 13..15)
        if (stepInBar === 0 || stepInBar === 6 || stepInBar === 10 || ((bar === 3 || bar === 7) && stepInBar === 14)) {
            playDrumKick(ctx, drumDest, offset, stepInBar === 0 ? 0.25 : 0.19);
        }

        if (stepInBar === 4 || stepInBar === 12) {
            playDrumSnareClap(ctx, drumDest, offset, isCalm ? 0.125 : 0.165, 'clap');
        } else if ((bar === 3 || bar === 7) && (stepInBar === 13 || stepInBar === 15)) {
            playDrumSnareClap(ctx, drumDest, offset, 0.095, 'snare');
        }

        // Cyber trap / glitch hi-hat pattern with pitched 16th rolls at end of bar
        if (stepInBar >= 13) {
            playDrumHat(ctx, drumDest, offset, 0.048, false, 8400 + (stepInBar - 13) * 900);
        } else if (stepInBar % 2 === 0 || stepInBar === 7 || isCrunch || isQueue) {
            const isOpen = stepInBar === 2 || stepInBar === 10;
            playDrumHat(ctx, drumDest, offset, isOpen ? 0.056 : 0.036, isOpen, 7900);
        }

        // Syncopated Phonk / Cyber Metallic Sonar Bell
        const bellFreq = SCORE_3077.phonkBellSteps[stepInBar];
        if (bellFreq > 0 && !isCalm) {
            playFmBell(ctx, melodyDest, {
                freq: bellFreq,
                modRatio: 1.414,
                modIndex: 2.2,
                startOffset: offset,
                duration: stepDur * 1.4,
                gain: 0.058,
                pan: stepInBar < 8 ? -0.35 : 0.35,
            });
        }

        // 2. Growling Cyberpunk Reese Bassline
        if (stepInBar === 0) {
            playReeseBass(ctx, drumDest, {
                freq: root,
                startOffset: offset,
                duration: stepDur * 5.2,
                gain: isCalm ? 0.105 : 0.135,
                filterFreq: 1450,
                filterFreqEnd: 220,
                filterQ: 3.4,
            });
        } else if (stepInBar === 6) {
            playReeseBass(ctx, drumDest, {
                freq: root * 2,
                freqEnd: root,
                startOffset: offset,
                duration: stepDur * 1.8,
                gain: 0.115,
                filterFreq: 1750,
                filterFreqEnd: 320,
                filterQ: 3.0,
            });
        } else if (stepInBar === 8) {
            playReeseBass(ctx, drumDest, {
                freq: root,
                startOffset: offset,
                duration: stepDur * 3.4,
                gain: isCalm ? 0.095 : 0.125,
                filterFreq: 1200,
                filterFreqEnd: 200,
                filterQ: 3.2,
            });
        } else if (stepInBar === 12) {
            // Phrygian half-step tension slide
            playReeseBass(ctx, drumDest, {
                freq: root * 1.05946,
                freqEnd: root,
                startOffset: offset,
                duration: stepDur * 3.6,
                gain: 0.12,
                filterFreq: 1550,
                filterFreqEnd: 240,
                filterQ: 3.5,
            });
        }

        // 3. Continuous 16-Step Acid Cyber-Arpeggiator
        if (!isCalm || stepInBar % 2 === 0) {
            const arpFreq = arpSeq[stepInBar];
            const lfoContour = 0.5 + 0.5 * Math.sin(((bar * 16 + stepInBar) / 16) * Math.PI * 2);
            const cutoff = (isCrunch ? 1800 : 2200) + lfoContour * 2800;
            playWarmVoice(ctx, melodyDest, {
                type: 'sawtooth',
                type2: 'square',
                freq: arpFreq,
                detuneCents: 10,
                startOffset: offset,
                attack: 0.003,
                duration: stepDur * 0.85,
                gain: isHeat || isQueue ? 0.056 : 0.046,
                filterFreq: cutoff,
                filterFreqEnd: Math.max(480, cutoff * 0.32),
                filterQ: 2.8,
                pan: (stepInBar % 2 === 0 ? -1 : 1) * 0.28,
            });
        }

        // 4. Dystopian Brass Power Stabs on Bar Downbeats
        if (stepInBar === 0 && (bar % 2 === 0 || isHeat || isQueue)) {
            stabChord.forEach((f, idx) => {
                playWarmVoice(ctx, melodyDest, {
                    type: 'sawtooth',
                    type2: 'sawtooth',
                    freq: f,
                    detuneCents: 14,
                    startOffset: offset,
                    attack: 0.012,
                    duration: stepDur * 3.5,
                    gain: 0.026,
                    filterFreq: 3800,
                    filterFreqEnd: 1100,
                    filterQ: 1.8,
                    pan: (idx - 1.5) * 0.25,
                });
            });
        }

        // 5. Cyber Riser on Bar 4 & Bar 8
        if ((bar === 3 || bar === 7) && stepInBar === 10) {
            playNoiseBurst(ctx, melodyDest, {
                startOffset: offset,
                attack: stepDur * 2.5,
                duration: stepDur * 5.8,
                gain: 0.065,
                filterType: 'bandpass',
                filterFreq: 800,
                filterFreqEnd: 5400,
                filterQ: 2.2,
            });
        }
    }

    // ─── Engine 2: Retro 80s Outrun Synthwave / Neon Arcade ───────────────────

    private scheduleRetroStep(
        ctx: AudioContext,
        drumDest: AudioNode,
        melodyDest: AudioNode,
        bar: number,
        stepInBar: number,
        offset: number,
        stepDur: number,
    ): void {
        const isCalm = this.scene === 'match_calm';
        const isHeat = this.scene === 'match_heat';
        const isCrunch = this.scene === 'match_crunch';
        const isQueue = this.scene === 'queueing';
        const isResult = this.scene === 'result';

        const root = SCORE_RETRO.bassRoots[bar];
        const padChord = SCORE_RETRO.padChords[bar];
        const fmLeadSeq = SCORE_RETRO.fmLeads[bar];

        // 1. Lush Sustained 80s Polysynth Chord Pad (1-bar sustain on step 0)
        if (stepInBar === 0) {
            playSynthPad(ctx, melodyDest, padChord, {
                startOffset: offset,
                attack: 0.11,
                duration: stepDur * (isResult ? 15 : 14.5),
                gain: isCalm ? 0.068 : 0.088,
                filterFreq: isCrunch ? 1900 : 2800,
                filterFreqEnd: 1100,
            });
        }

        if (isResult) return;

        // 2. Half-Time 80s Outrun Drum Groove + Iconic Stereo Synth-Tom Fills
        const isTomFillBar = (bar === 3 || bar === 7) && stepInBar >= 11;
        if (isTomFillBar) {
            // Iconic 80s Simmons/Linndrum descending stereo tom cascade (steps 11..15)
            const tomPitches = [290, 240, 195, 155, 120];
            const tomPans = [-0.6, -0.3, 0, 0.3, 0.6];
            const idx = stepInBar - 11;
            const startHz = tomPitches[idx] ?? 180;
            playSynthTom(ctx, drumDest, offset, 0.165, startHz, startHz * 0.36, tomPans[idx] ?? 0);
        } else {
            if (stepInBar === 0 || stepInBar === 8 || stepInBar === 14) {
                playDrumKick(ctx, drumDest, offset, stepInBar === 14 ? 0.16 : 0.23);
            }
            if (stepInBar === 4 || stepInBar === 12) {
                playDrumSnareClap(ctx, drumDest, offset, isCalm ? 0.13 : 0.165, 'snare');
            }
            if (stepInBar % 2 === 0 || isCrunch) {
                const isOpen = stepInBar === 6 || stepInBar === 14;
                playDrumHat(ctx, drumDest, offset, isOpen ? 0.052 : 0.032, isOpen, 6800);
            }
        }

        // 3. Rolling 8th/16th-Note Analog Outrun Arp Bass (Octave Pumping C2 -> C3)
        const playBassThisStep = isHeat || isQueue || isCrunch ? true : stepInBar % 2 === 0;
        if (playBassThisStep) {
            const isOctaveUp = stepInBar % 4 === 2;
            const bassFreq = isOctaveUp ? root * 2 : root;
            playWarmVoice(ctx, drumDest, {
                type: 'sawtooth',
                type2: 'triangle',
                freq: bassFreq,
                octaveSub: !isOctaveUp,
                detuneCents: 7,
                startOffset: offset,
                attack: 0.004,
                duration: stepDur * (playBassThisStep && (isHeat || isQueue || isCrunch) ? 0.92 : 1.75),
                gain: stepInBar % 4 === 0 ? 0.115 : 0.092,
                filterFreq: isOctaveUp ? 1650 : 1250,
                filterFreqEnd: 260,
                filterQ: 2.1,
            });
        }

        // 4. Glassy 80s DX7 FM Bell / Arcade Lead Melody
        if (!isCalm && stepInBar % 2 === 0) {
            const leadFreq = fmLeadSeq[stepInBar / 2];
            if (leadFreq > 0) {
                playFmBell(ctx, melodyDest, {
                    freq: leadFreq,
                    modRatio: 2.0,
                    modIndex: isHeat || isQueue ? 3.1 : 2.3,
                    startOffset: offset,
                    attack: 0.004,
                    duration: stepDur * 2.2,
                    gain: isHeat || isQueue ? 0.068 : 0.056,
                    pan: stepInBar % 4 === 0 ? -0.25 : 0.25,
                });
            }
        }
    }

    // ─── Engine 3: Light (Daybreak) Monte Carlo Bossa-Lounge & Marimba Jazz ───

    private scheduleLightStep(
        ctx: AudioContext,
        drumDest: AudioNode,
        melodyDest: AudioNode,
        bar: number,
        stepInBar: number,
        offset: number,
        stepDur: number,
    ): void {
        const isCalm = this.scene === 'match_calm';
        const isHeat = this.scene === 'match_heat';
        const isCrunch = this.scene === 'match_crunch';
        const isQueue = this.scene === 'queueing';
        const isResult = this.scene === 'result';

        const root = SCORE_LIGHT.bassRoots[bar];
        const fifth = SCORE_LIGHT.bassFifths[bar];
        const rhodesChord = SCORE_LIGHT.rhodesChords[bar];
        const marimbaSeq = SCORE_LIGHT.marimbaMelodies[bar];

        if (isResult) {
            if (stepInBar === 0) {
                playElectricPiano(ctx, melodyDest, rhodesChord, {
                    startOffset: offset,
                    stagger: 0.025,
                    duration: stepDur * 14,
                    gain: 0.09,
                });
            }
            return;
        }

        // 1. Authentic Bossa Nova Surdo Bass Drum (0, 6, 8, 14) + 3-2 Wooden Clave + Brushed Shakers
        if (stepInBar === 0 || stepInBar === 6 || stepInBar === 8 || stepInBar === 14) {
            const isDownbeat = stepInBar === 0 || stepInBar === 8;
            playTone(ctx, drumDest, {
                type: 'sine',
                freq: isDownbeat ? 118 : 132,
                freqEnd: isDownbeat ? 48 : 56,
                startOffset: offset,
                attack: 0.005,
                duration: isDownbeat ? 0.2 : 0.14,
                gain: isDownbeat ? 0.21 : 0.145,
            });
        }

        // 3-2 Bossa Nova Wooden Rim-Clave (steps 0, 3, 6, 10, 12)
        if (SCORE_LIGHT.bossaClaveSteps.has(stepInBar)) {
            playDrumSnareClap(ctx, drumDest, offset, isCalm ? 0.095 : 0.125, 'rim');
            playPercAccent(ctx, drumDest, offset, 0.055, stepInBar === 0 || stepInBar === 10 ? 780 : 660, stepInBar < 8 ? -0.25 : 0.25);
        }

        // Swung Brushed Pink-Noise Shaker on 16ths
        if (!isCalm || stepInBar % 2 === 0) {
            const isShakerAccent = stepInBar % 4 === 2;
            const swingOffset = stepInBar % 2 === 1 ? stepDur * 0.14 : 0;
            playShaker(
                ctx,
                drumDest,
                offset + swingOffset,
                isCrunch || isQueue ? 0.044 : 0.034,
                isShakerAccent,
                (stepInBar % 2 === 0 ? -1 : 1) * 0.22,
            );
        }

        // 2. Warm Upright / Fretless Walking Jazz Bass
        if (stepInBar === 0 || stepInBar === 6 || stepInBar === 8 || stepInBar === 14) {
            const bassFreq =
                stepInBar === 0
                    ? root
                    : stepInBar === 6
                      ? fifth
                      : stepInBar === 8
                        ? root
                        : fifth * 0.5;
            playWarmVoice(ctx, drumDest, {
                type: 'triangle',
                type2: 'sine',
                freq: bassFreq,
                detuneCents: 4,
                startOffset: offset,
                attack: 0.008,
                duration: stepDur * (stepInBar === 0 || stepInBar === 8 ? 4.8 : 2.1),
                gain: stepInBar === 0 || stepInBar === 8 ? 0.12 : 0.095,
                filterFreq: 680,
                filterFreqEnd: 220,
                filterQ: 1.4,
            });
        }

        // 3. Monte Carlo Rhodes Electric Piano Syncopated Comping (steps 0, 3, 6, 10, 14)
        if (SCORE_LIGHT.bossaCompSteps.has(stepInBar)) {
            const compDur = stepInBar === 6 || stepInBar === 10 ? stepDur * 2.8 : stepDur * 2.1;
            playElectricPiano(ctx, melodyDest, rhodesChord, {
                startOffset: offset,
                stagger: 0.01,
                duration: compDur,
                gain: isCalm ? 0.068 : 0.088,
                panSpread: 0.35,
            });
        }

        // 4. Tropical Wooden Marimba / Vibraphone Lead Melody
        const marimbaFreq = marimbaSeq[stepInBar];
        if (marimbaFreq > 0 && (!isCalm || stepInBar % 4 === 0)) {
            const swingOffset = stepInBar % 2 === 1 ? stepDur * 0.14 : 0;
            playMalletNote(ctx, melodyDest, {
                freq: marimbaFreq,
                startOffset: offset + swingOffset,
                duration: stepDur * 1.9,
                gain: isHeat || isQueue ? 0.082 : 0.068,
                pan: ((stepInBar % 4) - 1.5) * 0.22,
            });
        }
    }
}
