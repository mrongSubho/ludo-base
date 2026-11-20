/**
 * Procedural Web Audio synthesizer for Phase 1 pure-code boot ticks and 100% READY chime.
 * Follows the REA-12 teardown contract (`app/hooks/useAudio.ts`): every node disconnects
 * in `onended` and the AudioContext closes cleanly in `dispose()`.
 */

interface WindowWithWebkitAudio extends Window {
    webkitAudioContext?: typeof AudioContext;
}

export class BootPhase1Synth {
    private ctx: AudioContext | null = null;
    private enabled: boolean;

    constructor(enabled: boolean) {
        this.enabled = enabled;
    }

    public setEnabled(enabled: boolean): void {
        this.enabled = enabled;
    }

    public tryResume(): boolean {
        if (!this.enabled || typeof window === 'undefined') return false;
        const AudioCtor =
            window.AudioContext ?? (window as WindowWithWebkitAudio).webkitAudioContext;
        if (!AudioCtor) return false;

        if (!this.ctx) {
            try {
                this.ctx = new AudioCtor();
            } catch {
                return false;
            }
        }
        if (this.ctx.state === 'suspended') {
            this.ctx.resume().catch(() => undefined);
        }
        return this.ctx.state === 'running';
    }

    public playStepTick(stepIndex: number): void {
        const ctx = this.ctx;
        if (!this.enabled || !ctx || ctx.state !== 'running') return;
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        const startHz = 1320 + Math.max(0, stepIndex) * 180;
        osc.type = 'sine';
        osc.frequency.setValueAtTime(startHz, now);
        osc.frequency.exponentialRampToValueAtTime(2200, now + 0.028);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.045, now + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.032);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.onended = () => {
            try {
                osc.disconnect();
                gain.disconnect();
            } catch {
                // ignore teardown race
            }
        };
        osc.start(now);
        osc.stop(now + 0.036);
    }

    public playReadyChime(): void {
        const ctx = this.ctx;
        if (!this.enabled || !ctx || ctx.state !== 'running') return;
        const now = ctx.currentTime;

        // Crisp 3-note cyber-tactical triad
        const chord = [523.25, 783.99, 1046.5];
        chord.forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const filter = ctx.createBiquadFilter();
            const gain = ctx.createGain();
            const t0 = now + i * 0.03;

            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, t0);

            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(2400, t0);
            filter.frequency.exponentialRampToValueAtTime(680, t0 + 0.36);

            gain.gain.setValueAtTime(0.001, t0);
            gain.gain.linearRampToValueAtTime(0.052, t0 + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.38);

            osc.connect(filter);
            filter.connect(gain);
            gain.connect(ctx.destination);
            osc.onended = () => {
                try {
                    osc.disconnect();
                    filter.disconnect();
                    gain.disconnect();
                } catch {
                    // ignore
                }
            };
            osc.start(t0);
            osc.stop(t0 + 0.4);
        });

        // Soft sub-bass lockup thump
        const sub = ctx.createOscillator();
        const subGain = ctx.createGain();
        sub.type = 'sine';
        sub.frequency.setValueAtTime(115, now);
        sub.frequency.exponentialRampToValueAtTime(44, now + 0.24);
        subGain.gain.setValueAtTime(0.001, now);
        subGain.gain.linearRampToValueAtTime(0.14, now + 0.012);
        subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
        sub.connect(subGain);
        subGain.connect(ctx.destination);
        sub.onended = () => {
            try {
                sub.disconnect();
                subGain.disconnect();
            } catch {
                // ignore
            }
        };
        sub.start(now);
        sub.stop(now + 0.28);
    }

    public dispose(): void {
        if (this.ctx) {
            if (this.ctx.state !== 'closed') {
                this.ctx.close().catch(() => undefined);
            }
            this.ctx = null;
        }
    }
}
