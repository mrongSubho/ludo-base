import {
    playBinauralPulse,
    playDrumHat,
    playDrumKick,
    playDrumSnareClap,
    playElectricPiano,
    playFmBell,
    playHeartbeatPulse,
    playMalletNote,
    playPercAccent,
    playShaker,
    playSynthTom,
    playTone,
    playWarmVoice,
} from './synthPrimitives';
import type { AudioTheme, MusicScene } from './types';

/**
 * 14 Hz Binaural Beats + Bilateral Left <-> Right Stereo Alternation Constants.
 *
 * Instead of a continuous background drone (which causes an unwanted constant low hum),
 * every beat schedules rhythmic, chord-tuned dichotic 14 Hz binaural pulses (`freq - 7 Hz`
 * in the Left ear at pan = -1.0, `freq + 7 Hz` in the Right ear at pan = +1.0) that
 * alternate Left-leading (-1) and Right-leading (+1) in sync with bilateral stereo panning
 * across the melody, percussion, and chord voices.
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
    leadSide: -1 | 1;
}

// ─── Theme 1: 3077 — Cyberpunk Dark-Synth / Phonk-Industrial (136 -> 142 BPM, F Minor / Phrygian) ──
const SCORE_3077 = {
    lobbyBpm: 136,
    matchBpm: 142,
    // Crisp punchy mid-bass roots (F2..C3 register — zero muddy sub-hum)
    bassRoots: [87.31, 92.5, 103.83, 87.31, 69.3, 77.78, 87.31, 130.81] as const,
    binauralNotes: [349.23, 369.99, 415.3, 349.23, 277.18, 311.13, 349.23, 392.0] as const,
    powerStabs: [
        [349.23, 415.3, 523.25],  // Fm
        [369.99, 466.16, 554.37], // Gbmaj
        [415.3, 523.25, 622.25],  // Abmaj
        [349.23, 466.16, 523.25], // Fsus4
        [277.18, 349.23, 415.3],  // Dbmaj
        [311.13, 392.0, 466.16],  // Ebmaj
        [349.23, 415.3, 523.25],  // Fm
        [392.0, 493.88, 587.33],  // Gdim/C7
    ] as const,
    // 16-step hypnotic cyber-acid arpeggiator patterns (ping-ponged Left <-> Right ear)
    acidArps: [
        [349.23, 415.3, 523.25, 415.3, 698.46, 523.25, 415.3, 349.23, 370.0, 415.3, 523.25, 698.46, 622.25, 523.25, 415.3, 370.0],
        [370.0, 466.16, 554.37, 466.16, 739.99, 554.37, 466.16, 370.0, 349.23, 466.16, 554.37, 739.99, 698.46, 554.37, 466.16, 349.23],
        [415.3, 523.25, 622.25, 523.25, 830.61, 622.25, 523.25, 415.3, 466.16, 523.25, 622.25, 783.99, 698.46, 622.25, 523.25, 415.3],
        [349.23, 523.25, 698.46, 622.25, 523.25, 415.3, 370.0, 349.23, 523.25, 698.46, 830.61, 698.46, 622.25, 523.25, 415.3, 370.0],
    ] as const,
    phonkBellSteps: [0, 0, 0, 698.46, 0, 0, 830.61, 0, 0, 0, 739.99, 0, 0, 698.46, 0, 523.25] as const,
};

// ─── Theme 2: Retro — 80s Outrun Synthwave / Neon Arcade (102 -> 108 BPM, C Minor / Eb Major) ──
const SCORE_RETRO = {
    lobbyBpm: 102,
    matchBpm: 108,
    // Crisp staccato Outrun bass roots (C2..Eb3 octave pulse — zero droning pad hum)
    bassRoots: [130.81, 103.83, 155.56, 116.54, 87.31, 103.83, 98.0, 98.0] as const,
    binauralNotes: [261.63, 311.13, 311.13, 293.66, 261.63, 311.13, 293.66, 246.94] as const,
    pluckChords: [
        [261.63, 311.13, 392.0, 466.16], // Cm7
        [261.63, 311.13, 415.3, 523.25], // Abmaj7
        [311.13, 392.0, 466.16, 587.33], // Ebmaj7
        [293.66, 349.23, 466.16, 587.33], // Bb
        [261.63, 349.23, 415.3, 523.25], // Fm7
        [261.63, 311.13, 415.3, 523.25], // Abmaj7
        [261.63, 293.66, 392.0, 493.88], // G7sus4
        [246.94, 293.66, 392.0, 587.33], // G7
    ] as const,
    // 8 bars × 8 eighth-note FM Bell / Synthwave melody hooks (ping-ponged L <-> R)
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
    // Pizzicato upright bass roots (short plucked envelope — zero low booming drone)
    bassRoots: [146.83, 123.47, 164.81, 110.0, 185.0, 123.47, 196.0, 110.0] as const,
    bassFifths: [220.0, 185.0, 246.94, 164.81, 277.18, 185.0, 293.66, 164.81] as const,
    binauralNotes: [293.66, 246.94, 329.63, 277.18, 369.99, 293.66, 392.0, 329.63] as const,
    rhodesChords: [
        [293.66, 369.99, 440.0, 554.37], // Dmaj7
        [246.94, 293.66, 369.99, 440.0], // Bm7
        [329.63, 392.0, 493.88, 587.33], // Em7
        [277.18, 329.63, 392.0, 440.0],  // A7
        [277.18, 329.63, 369.99, 493.88], // F#m7
        [246.94, 293.66, 369.99, 440.0], // Bm7
        [293.66, 392.0, 493.88, 587.33], // Gmaj7
        [277.18, 329.63, 392.0, 554.37], // A9
    ] as const,
    bossaClaveSteps: new Set([0, 3, 6, 10, 12]),
    bossaCompSteps: new Set([0, 3, 6, 10, 14]),
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
    private lastLeadSide: -1 | 1 = -1;

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
            active: this.isPlaying && this.scene !== 'silent',
            beatHz: BINAURAL_BEAT_HZ,
            carrierHz,
            leftHz,
            rightHz,
            leadSide: this.lastLeadSide,
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
        } else if (sceneChanged && next === 'match_crunch') {
            const ctx = this.getCtx();
            if (ctx) this.nextHeartbeatTime = ctx.currentTime + 0.04;
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
        if (this.timerId) {
            clearInterval(this.timerId);
            this.timerId = null;
        }
        if (this.heartbeatTimerId) {
            clearInterval(this.heartbeatTimerId);
            this.heartbeatTimerId = null;
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
            this.onFilterTarget(3200, 1.1);
        } else if (this.scene === 'match_calm') {
            this.onFilterTarget(8500, 0.7);
        } else if (this.scene === 'result') {
            this.onFilterTarget(4800, 0.7);
        } else {
            this.onFilterTarget(12000, 0.7);
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
        const binauralDest = this.getBinauralDest() ?? melodyDest;

        // Alternate Left (-1) and Right (+1) ear focus rhythmically on every 8th/16th step
        const leadSide: -1 | 1 = (stepInBar % 2 === 0 ? (stepInBar % 4 === 0 ? -1 : 1) : (stepInBar % 4 === 1 ? 1 : -1));
        this.lastLeadSide = leadSide;

        if (this.theme === '3077') {
            this.schedule3077Step(ctx, drumDest, melodyDest, binauralDest, bar, stepInBar, offset, stepDur, leadSide);
        } else if (this.theme === 'retro') {
            this.scheduleRetroStep(ctx, drumDest, melodyDest, binauralDest, bar, stepInBar, offset, stepDur, leadSide);
        } else {
            this.scheduleLightStep(ctx, drumDest, melodyDest, binauralDest, bar, stepInBar, offset, stepDur, leadSide);
        }
    }

    // ─── Engine 1: 3077 Cyberpunk Dark-Synth / Phonk-Industrial Breakbeat ─────

    private schedule3077Step(
        ctx: AudioContext,
        drumDest: AudioNode,
        melodyDest: AudioNode,
        binauralDest: AudioNode,
        bar: number,
        stepInBar: number,
        offset: number,
        stepDur: number,
        leadSide: -1 | 1,
    ): void {
        const isCalm = this.scene === 'match_calm';
        const isHeat = this.scene === 'match_heat';
        const isCrunch = this.scene === 'match_crunch';
        const isQueue = this.scene === 'queueing';
        const isResult = this.scene === 'result';

        const root = SCORE_3077.bassRoots[bar];
        const binauralFreq = SCORE_3077.binauralNotes[bar];
        const stabChord = SCORE_3077.powerStabs[bar];
        const arpSeq = SCORE_3077.acidArps[bar % SCORE_3077.acidArps.length];

        // 1. Rhythmic Bilateral 14 Hz Binaural Pulse (Left ear: freq - 7 Hz, Right ear: freq + 7 Hz, ping-ponging L <-> R)
        if (stepInBar % 2 === 0) {
            const octaveMult = stepInBar % 4 === 2 ? 1.5 : 1.0;
            playBinauralPulse(ctx, binauralDest, {
                freq: binauralFreq * octaveMult,
                beatHz: BINAURAL_BEAT_HZ,
                leadSide,
                startOffset: offset,
                duration: stepDur * 1.65,
                gain: isResult ? 0.055 : 0.082,
            });
        }

        if (isResult) return;

        // 2. Syncopated Breakbeat Drums (Kick on 0, 6, 10; Snare on 4, 12; Stereo Glitch Hat Rolls on 13..15)
        if (stepInBar === 0 || stepInBar === 6 || stepInBar === 10 || ((bar === 3 || bar === 7) && stepInBar === 14)) {
            playDrumKick(ctx, drumDest, offset, stepInBar === 0 ? 0.24 : 0.18);
        }

        if (stepInBar === 4 || stepInBar === 12) {
            playDrumSnareClap(ctx, drumDest, offset, isCalm ? 0.12 : 0.16, 'clap');
        } else if ((bar === 3 || bar === 7) && (stepInBar === 13 || stepInBar === 15)) {
            playDrumSnareClap(ctx, drumDest, offset, 0.095, 'snare');
        }

        // Bilateral stereo hi-hats & end-of-bar glitch roll
        if (stepInBar >= 13) {
            playDrumHat(ctx, drumDest, offset, 0.05, false, 8400 + (stepInBar - 13) * 900);
        } else if (stepInBar % 2 === 0 || stepInBar === 7 || isCrunch || isQueue) {
            const isOpen = stepInBar === 2 || stepInBar === 10;
            playDrumHat(ctx, drumDest, offset, isOpen ? 0.054 : 0.035, isOpen, 7900);
        }

        // Syncopated Phonk / Cyber Metallic Sonar Bell (hard-panned L <-> R)
        const bellFreq = SCORE_3077.phonkBellSteps[stepInBar];
        if (bellFreq > 0 && !isCalm) {
            playFmBell(ctx, melodyDest, {
                freq: bellFreq,
                modRatio: 1.414,
                modIndex: 2.1,
                startOffset: offset,
                duration: stepDur * 1.25,
                gain: 0.062,
                pan: leadSide * 0.88,
            });
        }

        // 3. Tight Staccato Cyber Pluck Bass (NO long droning Reese hum!)
        if (stepInBar === 0 || stepInBar === 3 || stepInBar === 6 || stepInBar === 8 || stepInBar === 10 || stepInBar === 12 || stepInBar === 14) {
            const isOctave = stepInBar === 3 || stepInBar === 10 || stepInBar === 14;
            const bassFreq = isOctave ? root * 2 : root;
            playWarmVoice(ctx, drumDest, {
                type: 'sawtooth',
                type2: 'square',
                freq: bassFreq,
                detuneCents: 8,
                startOffset: offset,
                attack: 0.003,
                duration: stepDur * 1.1,
                gain: stepInBar === 0 || stepInBar === 8 ? 0.115 : 0.088,
                filterFreq: 1750,
                filterFreqEnd: 240,
                filterQ: 2.4,
                pan: isOctave ? leadSide * 0.45 : 0,
            });
        }

        // 4. Bilateral Ping-Pong 16-Step Acid Cyber-Arpeggiator (Bounces Left -0.90 <-> Right +0.90)
        if (!isCalm || stepInBar % 2 === 0) {
            const arpFreq = arpSeq[stepInBar];
            const lfoContour = 0.5 + 0.5 * Math.sin(((bar * 16 + stepInBar) / 16) * Math.PI * 2);
            const cutoff = (isCrunch ? 2000 : 2400) + lfoContour * 2800;
            const stereoBouncePan = (stepInBar % 2 === 0 ? -1 : 1) * 0.9;
            playWarmVoice(ctx, melodyDest, {
                type: 'sawtooth',
                type2: 'triangle',
                freq: arpFreq,
                detuneCents: 9,
                startOffset: offset,
                attack: 0.003,
                duration: stepDur * 0.82,
                gain: isHeat || isQueue ? 0.058 : 0.048,
                filterFreq: cutoff,
                filterFreqEnd: Math.max(520, cutoff * 0.35),
                filterQ: 2.5,
                pan: stereoBouncePan,
            });
        }

        // 5. Crisp Short Cyber Chord Stabs alternating Left and Right ears (steps 0 and 10)
        if (stepInBar === 0 || stepInBar === 10) {
            const stabPan = stepInBar === 0 ? -0.78 : 0.78;
            stabChord.forEach((f, idx) => {
                playWarmVoice(ctx, melodyDest, {
                    type: 'sawtooth',
                    type2: 'triangle',
                    freq: f,
                    detuneCents: 10,
                    startOffset: offset + idx * 0.006,
                    attack: 0.005,
                    duration: stepDur * 1.35,
                    gain: 0.028,
                    filterFreq: 3600,
                    filterFreqEnd: 950,
                    filterQ: 1.6,
                    pan: stabPan,
                });
            });
        }
    }

    // ─── Engine 2: Retro 80s Outrun Synthwave / Neon Arcade ───────────────────

    private scheduleRetroStep(
        ctx: AudioContext,
        drumDest: AudioNode,
        melodyDest: AudioNode,
        binauralDest: AudioNode,
        bar: number,
        stepInBar: number,
        offset: number,
        stepDur: number,
        leadSide: -1 | 1,
    ): void {
        const isCalm = this.scene === 'match_calm';
        const isHeat = this.scene === 'match_heat';
        const isCrunch = this.scene === 'match_crunch';
        const isQueue = this.scene === 'queueing';
        const isResult = this.scene === 'result';

        const root = SCORE_RETRO.bassRoots[bar];
        const binauralFreq = SCORE_RETRO.binauralNotes[bar];
        const pluckChord = SCORE_RETRO.pluckChords[bar];
        const fmLeadSeq = SCORE_RETRO.fmLeads[bar];

        // 1. Rhythmic Bilateral 14 Hz Binaural Pulse (Left ear: freq - 7 Hz, Right ear: freq + 7 Hz, alternating L <-> R)
        if (stepInBar % 2 === 0) {
            const harmonicMult = stepInBar % 4 === 2 ? 1.498 : 1.0;
            playBinauralPulse(ctx, binauralDest, {
                freq: binauralFreq * harmonicMult,
                beatHz: BINAURAL_BEAT_HZ,
                leadSide,
                startOffset: offset,
                duration: stepDur * 1.7,
                gain: isResult ? 0.055 : 0.084,
            });
        }

        if (isResult) return;

        // 2. Rhythmic Off-Beat 80s Synthwave Chord Plucks alternating Left (-0.86) <-> Right (+0.86) (NO bar-long pad hum!)
        if (stepInBar === 2 || stepInBar === 6 || stepInBar === 10 || stepInBar === 14) {
            const chordPan = (stepInBar === 2 || stepInBar === 10) ? -0.86 : 0.86;
            pluckChord.forEach((f, idx) => {
                playWarmVoice(ctx, melodyDest, {
                    type: 'sawtooth',
                    type2: 'triangle',
                    freq: f,
                    detuneCents: 9,
                    startOffset: offset + idx * 0.007,
                    attack: 0.005,
                    duration: stepDur * 1.35,
                    gain: (isCalm ? 0.025 : 0.034),
                    filterFreq: isCrunch ? 2400 : 3600,
                    filterFreqEnd: 850,
                    filterQ: 1.4,
                    pan: chordPan,
                });
            });
        }

        // 3. Half-Time 80s Outrun Drum Groove + Iconic Stereo Synth-Tom Fills (L -> C -> R)
        const isTomFillBar = (bar === 3 || bar === 7) && stepInBar >= 11;
        if (isTomFillBar) {
            const tomPitches = [290, 240, 195, 155, 120];
            const tomPans = [-0.9, -0.45, 0, 0.45, 0.9];
            const idx = stepInBar - 11;
            const startHz = tomPitches[idx] ?? 180;
            playSynthTom(ctx, drumDest, offset, 0.16, startHz, startHz * 0.36, tomPans[idx] ?? 0);
        } else {
            if (stepInBar === 0 || stepInBar === 8 || stepInBar === 14) {
                playDrumKick(ctx, drumDest, offset, stepInBar === 14 ? 0.15 : 0.22);
            }
            if (stepInBar === 4 || stepInBar === 12) {
                playDrumSnareClap(ctx, drumDest, offset, isCalm ? 0.125 : 0.16, 'snare');
            }
            if (stepInBar % 2 === 0 || isCrunch) {
                const isOpen = stepInBar === 6 || stepInBar === 14;
                playDrumHat(ctx, drumDest, offset, isOpen ? 0.05 : 0.032, isOpen, 6800);
            }
        }

        // 4. Staccato Rolling 80s Analog Arp Bass (Crisp short decay, alternating stereo on octave jumps)
        const playBassThisStep = isHeat || isQueue || isCrunch ? true : stepInBar % 2 === 0;
        if (playBassThisStep) {
            const isOctaveUp = stepInBar % 4 === 2;
            const bassFreq = isOctaveUp ? root * 2 : root;
            playWarmVoice(ctx, drumDest, {
                type: 'sawtooth',
                type2: 'triangle',
                freq: bassFreq,
                detuneCents: 6,
                startOffset: offset,
                attack: 0.003,
                duration: stepDur * 0.88,
                gain: stepInBar % 4 === 0 ? 0.105 : 0.084,
                filterFreq: isOctaveUp ? 1850 : 1350,
                filterFreqEnd: 260,
                filterQ: 2.0,
                pan: isOctaveUp ? leadSide * 0.65 : 0,
            });
        }

        // 5. Glassy 80s DX7 FM Bell / Arcade Lead Melody (Hard-panned alternating Left -0.90 <-> Right +0.90)
        if (!isCalm && stepInBar % 2 === 0) {
            const leadFreq = fmLeadSeq[stepInBar / 2];
            if (leadFreq > 0) {
                const bellPan = ((stepInBar / 2) % 2 === 0 ? -1 : 1) * 0.9;
                playFmBell(ctx, melodyDest, {
                    freq: leadFreq,
                    modRatio: 2.0,
                    modIndex: isHeat || isQueue ? 3.0 : 2.2,
                    startOffset: offset,
                    attack: 0.004,
                    duration: stepDur * 1.85,
                    gain: isHeat || isQueue ? 0.068 : 0.056,
                    pan: bellPan,
                });
            }
        }
    }

    // ─── Engine 3: Light (Daybreak) Monte Carlo Bossa-Lounge & Marimba Jazz ───

    private scheduleLightStep(
        ctx: AudioContext,
        drumDest: AudioNode,
        melodyDest: AudioNode,
        binauralDest: AudioNode,
        bar: number,
        stepInBar: number,
        offset: number,
        stepDur: number,
        leadSide: -1 | 1,
    ): void {
        const isCalm = this.scene === 'match_calm';
        const isHeat = this.scene === 'match_heat';
        const isCrunch = this.scene === 'match_crunch';
        const isQueue = this.scene === 'queueing';
        const isResult = this.scene === 'result';

        const root = SCORE_LIGHT.bassRoots[bar];
        const fifth = SCORE_LIGHT.bassFifths[bar];
        const binauralFreq = SCORE_LIGHT.binauralNotes[bar];
        const rhodesChord = SCORE_LIGHT.rhodesChords[bar];
        const marimbaSeq = SCORE_LIGHT.marimbaMelodies[bar];

        // 1. Rhythmic Bilateral 14 Hz Binaural Pulse (Left ear: freq - 7 Hz, Right ear: freq + 7 Hz, alternating L <-> R)
        if (stepInBar % 2 === 0) {
            const fifthMult = stepInBar % 4 === 2 ? 1.498 : 1.0;
            playBinauralPulse(ctx, binauralDest, {
                freq: binauralFreq * fifthMult,
                beatHz: BINAURAL_BEAT_HZ,
                leadSide,
                startOffset: offset,
                duration: stepDur * 1.75,
                gain: isResult ? 0.055 : 0.082,
            });
        }

        if (isResult) return;

        // 2. Tight Bossa Percussion + Bilateral Left <-> Right Wooden Rim-Clave & Brushed Shakers
        if (stepInBar === 0 || stepInBar === 6 || stepInBar === 8 || stepInBar === 14) {
            const isDownbeat = stepInBar === 0 || stepInBar === 8;
            playTone(ctx, drumDest, {
                type: 'sine',
                freq: isDownbeat ? 132 : 148,
                freqEnd: isDownbeat ? 54 : 62,
                startOffset: offset,
                attack: 0.004,
                duration: isDownbeat ? 0.13 : 0.1,
                gain: isDownbeat ? 0.18 : 0.13,
            });
        }

        // 3-2 Bossa Nova Wooden Rim-Clave alternating Left (-0.85) and Right (+0.85)
        if (SCORE_LIGHT.bossaClaveSteps.has(stepInBar)) {
            const clavePan = (stepInBar === 0 || stepInBar === 6 || stepInBar === 12) ? -0.85 : 0.85;
            playDrumSnareClap(ctx, drumDest, offset, isCalm ? 0.09 : 0.12, 'rim');
            playPercAccent(ctx, drumDest, offset, 0.058, stepInBar === 0 || stepInBar === 10 ? 820 : 680, clavePan);
        }

        // Swung Brushed Pink-Noise Shaker ping-ponging Left (-0.88) <-> Right (+0.88) on every 16th
        if (!isCalm || stepInBar % 2 === 0) {
            const isShakerAccent = stepInBar % 4 === 2;
            const swingOffset = stepInBar % 2 === 1 ? stepDur * 0.14 : 0;
            const shakerPan = (stepInBar % 2 === 0 ? -1 : 1) * 0.88;
            playShaker(
                ctx,
                drumDest,
                offset + swingOffset,
                isCrunch || isQueue ? 0.044 : 0.034,
                isShakerAccent,
                shakerPan,
            );
        }

        // 3. Crisp Pizzicato Upright Jazz Bass (Short plucked decay — zero low droning hum!)
        if (stepInBar === 0 || stepInBar === 6 || stepInBar === 8 || stepInBar === 14) {
            const bassFreq =
                stepInBar === 0
                    ? root
                    : stepInBar === 6
                      ? fifth
                      : stepInBar === 8
                        ? root
                        : fifth;
            playWarmVoice(ctx, drumDest, {
                type: 'triangle',
                type2: 'sine',
                freq: bassFreq,
                detuneCents: 3,
                startOffset: offset,
                attack: 0.004,
                duration: stepDur * 1.2,
                gain: stepInBar === 0 || stepInBar === 8 ? 0.105 : 0.085,
                filterFreq: 920,
                filterFreqEnd: 240,
                filterQ: 1.2,
                pan: (stepInBar === 6 || stepInBar === 14) ? leadSide * 0.5 : 0,
            });
        }

        // 4. Monte Carlo Rhodes Electric Piano Syncopated Comping (Alternating Left -0.70 <-> Right +0.70)
        if (SCORE_LIGHT.bossaCompSteps.has(stepInBar)) {
            const compPan = (stepInBar === 0 || stepInBar === 6 || stepInBar === 14) ? -0.68 : 0.68;
            playElectricPiano(ctx, melodyDest, rhodesChord, {
                startOffset: offset,
                stagger: 0.008,
                duration: stepDur * 1.45,
                gain: isCalm ? 0.064 : 0.082,
                panSpread: 0.22,
                panCenter: compPan,
            });
        }

        // 5. Tropical Wooden Marimba / Vibraphone Lead Melody (Bouncing Left -0.92 <-> Right +0.92)
        const marimbaFreq = marimbaSeq[stepInBar];
        if (marimbaFreq > 0 && (!isCalm || stepInBar % 4 === 0)) {
            const swingOffset = stepInBar % 2 === 1 ? stepDur * 0.14 : 0;
            const marimbaPan = (stepInBar % 2 === 0 ? -1 : 1) * 0.92;
            playMalletNote(ctx, melodyDest, {
                freq: marimbaFreq,
                startOffset: offset + swingOffset,
                duration: stepDur * 1.55,
                gain: isHeat || isQueue ? 0.085 : 0.072,
                pan: marimbaPan,
            });
        }
    }
}
