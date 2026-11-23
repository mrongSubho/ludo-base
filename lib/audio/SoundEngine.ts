import { MusicDirector } from './MusicDirector';
import { SFX_CATALOG } from './sfxCatalog';
import {
    AudioPrefsSnapshot,
    AudioTheme,
    MusicScene,
    SoundId,
    SoundPlayOptions,
    normalizeAudioTheme,
} from './types';

interface WindowWithAudio extends Window {
    webkitAudioContext?: typeof AudioContext;
}

const DEFAULT_PREFS: AudioPrefsSnapshot = {
    theme: '3077',
    sfx: true,
    music: true,
    sfxVolume: 80,
    musicVolume: 70,
    haptics: true,
};

const MUSIC_BASE_GAIN = 0.22;
const HEARTBEAT_BASE_GAIN = 0.42;
const SFX_BASE_GAIN = 0.85;
const UI_BASE_GAIN = 0.72;

export interface SoundEngineOptions {
    createContext?: () => AudioContext | null;
}

export class SoundEngine {
    private ctx: AudioContext | null = null;
    private masterBus: GainNode | null = null;
    private musicBus: GainNode | null = null;
    private musicFilter: BiquadFilterNode | null = null;
    private heartbeatBus: GainNode | null = null;
    private sfxBus: GainNode | null = null;
    private uiBus: GainNode | null = null;
    private compressor: DynamicsCompressorNode | null = null;

    private prefs: AudioPrefsSnapshot = { ...DEFAULT_PREFS };
    private appState: 'dashboard' | 'game' | 'spectating' = 'dashboard';
    private matchMood: MusicScene = 'match_calm';
    private matchUrgency = 0;

    private modalDuckCount = 0;
    private queueingCount = 0;
    private stingerDuckFactor = 1;
    private stingerTimer: ReturnType<typeof setTimeout> | null = null;

    private lastPlayedAt = new Map<SoundId, number>();
    private lifecycleCleanup: (() => void) | null = null;
    private isTabHidden = false;
    private createContextFn?: () => AudioContext | null;
    private director: MusicDirector;

    constructor(opts?: SoundEngineOptions) {
        this.createContextFn = opts?.createContext;
        this.director = new MusicDirector({
            getCtx: () => this.ctx,
            getMusicDest: () => this.musicFilter ?? this.musicBus,
            getHeartbeatDest: () => this.heartbeatBus,
            onFilterTarget: (cutoffHz, q) => this.applyMusicFilter(cutoffHz, q),
        });
    }

    public getAudioContext(): AudioContext | null {
        return this.ctx;
    }

    public getPrefs(): AudioPrefsSnapshot {
        return { ...this.prefs };
    }

    public updatePrefs(partial: Partial<Omit<AudioPrefsSnapshot, 'theme'> & { theme: string }>): void {
        const prevTheme = this.prefs.theme;
        const next: AudioPrefsSnapshot = {
            theme: partial.theme !== undefined ? normalizeAudioTheme(partial.theme) : this.prefs.theme,
            sfx: partial.sfx !== undefined ? Boolean(partial.sfx) : this.prefs.sfx,
            music: partial.music !== undefined ? Boolean(partial.music) : this.prefs.music,
            sfxVolume: partial.sfxVolume !== undefined ? clampPct(partial.sfxVolume) : this.prefs.sfxVolume,
            musicVolume: partial.musicVolume !== undefined ? clampPct(partial.musicVolume) : this.prefs.musicVolume,
            haptics: partial.haptics !== undefined ? Boolean(partial.haptics) : this.prefs.haptics,
        };
        this.prefs = next;

        if (next.theme !== prevTheme) {
            this.director.setTheme(next.theme);
        }

        this.syncBuses();
        this.syncMusicDirector();
    }

    public setAppScene(state: 'dashboard' | 'game' | 'spectating'): void {
        this.appState = state;
        if (state === 'dashboard') {
            this.matchMood = 'match_calm';
            this.matchUrgency = 0;
        }
        this.syncMusicDirector();
    }

    public setMatchMood(scene: MusicScene, urgency = 0): void {
        this.matchMood = scene;
        this.matchUrgency = Math.max(0, Math.min(1, urgency));
        this.syncMusicDirector();
    }

    public setTheme(theme: string): void {
        this.updatePrefs({ theme });
    }

    public pushModalDuck(): void {
        this.modalDuckCount += 1;
        this.syncBuses();
        this.applyMusicFilter(this.computeFilterCutoff(), 0.7);
    }

    public popModalDuck(): void {
        this.modalDuckCount = Math.max(0, this.modalDuckCount - 1);
        this.syncBuses();
        this.applyMusicFilter(this.computeFilterCutoff(), 0.7);
    }

    public pushQueueing(): void {
        this.queueingCount += 1;
        this.syncMusicDirector();
    }

    public popQueueing(): void {
        this.queueingCount = Math.max(0, this.queueingCount - 1);
        this.syncMusicDirector();
    }

    public duckMusic(factor = 0.45, holdMs = 500, releaseMs = 450): void {
        this.stingerDuckFactor = Math.max(0.1, Math.min(1, factor));
        this.syncBuses();
        if (this.stingerTimer) clearTimeout(this.stingerTimer);
        this.stingerTimer = setTimeout(() => {
            this.stingerDuckFactor = 1;
            this.syncBuses(Math.max(0.05, releaseMs / 1000));
            this.stingerTimer = null;
        }, holdMs);
    }

    public unlock(): boolean {
        const ctx = this.ensureContext();
        if (!ctx) return false;
        if (ctx.state === 'suspended') {
            void ctx.resume().then(() => {
                this.syncBuses();
                this.syncMusicDirector();
            }).catch(() => undefined);
        } else {
            this.syncBuses();
            this.syncMusicDirector();
        }
        return ctx.state === 'running';
    }

    public installLifecycleListeners(): () => void {
        if (this.lifecycleCleanup) return this.lifecycleCleanup;
        if (typeof window === 'undefined' || typeof document === 'undefined') {
            return () => undefined;
        }

        const handleGesture = () => {
            this.unlock();
        };

        const handleVisibility = () => {
            const hidden = document.visibilityState === 'hidden';
            this.isTabHidden = hidden;
            if (hidden) {
                this.director.stop();
                if (this.ctx && this.ctx.state === 'running' && typeof this.ctx.suspend === 'function') {
                    void this.ctx.suspend().catch(() => undefined);
                }
            } else {
                if (this.ctx && this.ctx.state === 'suspended' && typeof this.ctx.resume === 'function') {
                    void this.ctx.resume().catch(() => undefined);
                }
                this.syncMusicDirector();
            }
        };

        const events = ['pointerdown', 'keydown', 'touchstart'] as const;
        events.forEach((ev) => window.addEventListener(ev, handleGesture, { passive: true }));
        document.addEventListener('visibilitychange', handleVisibility);

        const cleanup = () => {
            events.forEach((ev) => window.removeEventListener(ev, handleGesture));
            document.removeEventListener('visibilitychange', handleVisibility);
            this.lifecycleCleanup = null;
        };
        this.lifecycleCleanup = cleanup;
        return cleanup;
    }

    public triggerHaptic(pattern: number | number[] = 10): void {
        if (!this.prefs.haptics) return;
        if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
        if (typeof navigator.vibrate === 'function') {
            try {
                navigator.vibrate(pattern);
            } catch {
                /* ignore unsupported vibration calls */
            }
        }
    }

    public play(id: SoundId, opts: SoundPlayOptions = {}): boolean {
        const recipe = SFX_CATALOG[id];
        if (!recipe) return false;

        if (!opts.force && (!this.prefs.sfx || this.prefs.sfxVolume <= 0)) {
            return false;
        }
        if (this.isTabHidden && !opts.force) return false;

        const nowMs = Date.now();
        const cooldown = recipe.cooldownMs ?? 0;
        if (!opts.force && cooldown > 0) {
            const last = this.lastPlayedAt.get(id) ?? 0;
            if (nowMs - last < cooldown) return false;
        }

        const ctx = this.ensureContext();
        if (!ctx) return false;
        if (ctx.state === 'suspended') {
            void ctx.resume().catch(() => undefined);
        }

        const bus = recipe.category === 'ui' ? this.uiBus : this.sfxBus;
        if (!bus) return false;

        this.lastPlayedAt.set(id, nowMs);

        if (recipe.duckMusic) {
            this.duckMusic(recipe.duckMusic.factor, recipe.duckMusic.holdMs, recipe.duckMusic.releaseMs);
        }
        if (recipe.haptic !== undefined) {
            this.triggerHaptic(recipe.haptic);
        }

        const dest = this.wrapCallVolume(ctx, bus, opts.volume);
        const theme: AudioTheme = opts.theme ?? this.prefs.theme;
        recipe.render(ctx, dest, opts, theme);
        return true;
    }

    public getMusicDirectorState(): ReturnType<MusicDirector['getState']> {
        return this.director.getState();
    }

    public getModalDuckCount(): number {
        return this.modalDuckCount;
    }

    public getQueueingCount(): number {
        return this.queueingCount;
    }

    public dispose(): void {
        this.director.stop();
        if (this.stingerTimer) {
            clearTimeout(this.stingerTimer);
            this.stingerTimer = null;
        }
        if (this.lifecycleCleanup) {
            this.lifecycleCleanup();
            this.lifecycleCleanup = null;
        }
        if (this.ctx) {
            if (this.ctx.state !== 'closed' && typeof this.ctx.close === 'function') {
                void this.ctx.close().catch(() => undefined);
            }
            this.ctx = null;
        }
        this.masterBus = null;
        this.musicBus = null;
        this.musicFilter = null;
        this.heartbeatBus = null;
        this.sfxBus = null;
        this.uiBus = null;
        this.compressor = null;
        this.lastPlayedAt.clear();
        this.modalDuckCount = 0;
        this.queueingCount = 0;
        this.stingerDuckFactor = 1;
    }

    private ensureContext(): AudioContext | null {
        if (this.ctx && this.ctx.state !== 'closed') return this.ctx;

        let created: AudioContext | null = null;
        if (this.createContextFn) {
            created = this.createContextFn();
        } else if (typeof window !== 'undefined') {
            const Ctor = window.AudioContext ?? (window as WindowWithAudio).webkitAudioContext;
            if (Ctor) {
                try {
                    created = new Ctor();
                } catch {
                    created = null;
                }
            }
        }
        if (!created) return null;

        this.ctx = created;
        this.masterBus = created.createGain();
        this.musicBus = created.createGain();
        this.heartbeatBus = created.createGain();
        this.sfxBus = created.createGain();
        this.uiBus = created.createGain();

        if (typeof created.createBiquadFilter === 'function') {
            this.musicFilter = created.createBiquadFilter();
            this.musicFilter.type = 'lowpass';
            this.musicFilter.frequency.setValueAtTime(3400, created.currentTime);
            this.musicFilter.connect(this.musicBus);
        } else {
            this.musicFilter = null;
        }

        if (typeof created.createDynamicsCompressor === 'function') {
            this.compressor = created.createDynamicsCompressor();
            this.compressor.threshold.setValueAtTime(-12, created.currentTime);
            this.compressor.knee.setValueAtTime(18, created.currentTime);
            this.compressor.ratio.setValueAtTime(4, created.currentTime);
            this.compressor.attack.setValueAtTime(0.004, created.currentTime);
            this.compressor.release.setValueAtTime(0.18, created.currentTime);
            this.masterBus.connect(this.compressor);
            this.compressor.connect(created.destination);
        } else {
            this.compressor = null;
            this.masterBus.connect(created.destination);
        }

        this.musicBus.connect(this.masterBus);
        this.heartbeatBus.connect(this.masterBus);
        this.sfxBus.connect(this.masterBus);
        this.uiBus.connect(this.masterBus);

        this.syncBuses(0.01);
        return created;
    }

    private syncBuses(rampSec = 0.08): void {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const musicScalar = this.prefs.music ? (this.prefs.musicVolume / 100) : 0;
        const sfxScalar = this.prefs.sfx ? (this.prefs.sfxVolume / 100) : 0;
        const modalFactor = this.modalDuckCount > 0 ? 0.56 : 1;
        const musicGain = MUSIC_BASE_GAIN * musicScalar * modalFactor * this.stingerDuckFactor;
        const hbGain = HEARTBEAT_BASE_GAIN * Math.max(musicScalar, sfxScalar * 0.5);

        this.setGainSmooth(this.masterBus, 1, now, rampSec);
        this.setGainSmooth(this.musicBus, musicGain, now, rampSec);
        this.setGainSmooth(this.heartbeatBus, hbGain, now, rampSec);
        this.setGainSmooth(this.sfxBus, SFX_BASE_GAIN * sfxScalar, now, 0.03);
        this.setGainSmooth(this.uiBus, UI_BASE_GAIN * sfxScalar, now, 0.03);
    }

    private setGainSmooth(node: GainNode | null, value: number, now: number, rampSec: number): void {
        if (!node) return;
        try {
            if (typeof node.gain.cancelScheduledValues === 'function') {
                node.gain.cancelScheduledValues(now);
            }
            if (typeof node.gain.setTargetAtTime === 'function') {
                node.gain.setTargetAtTime(value, now, Math.max(0.01, rampSec / 3));
            } else {
                node.gain.setValueAtTime(value, now);
            }
        } catch {
            node.gain.value = value;
        }
    }

    private computeFilterCutoff(): number {
        if (this.modalDuckCount > 0) return 1100;
        if (this.matchMood === 'match_crunch' && this.appState !== 'dashboard') return 720;
        if (this.matchMood === 'match_calm' && this.appState !== 'dashboard') return 1550;
        return 3400;
    }

    private applyMusicFilter(cutoffHz: number, q: number): void {
        if (!this.ctx || !this.musicFilter) return;
        const now = this.ctx.currentTime;
        const effectiveCutoff = this.modalDuckCount > 0 ? Math.min(cutoffHz, 1100) : cutoffHz;
        try {
            if (typeof this.musicFilter.frequency.setTargetAtTime === 'function') {
                this.musicFilter.frequency.setTargetAtTime(effectiveCutoff, now, 0.12);
            } else {
                this.musicFilter.frequency.setValueAtTime(effectiveCutoff, now);
            }
            this.musicFilter.Q.setValueAtTime(q, now);
        } catch {
            /* ignore mock limitations */
        }
    }

    private syncMusicDirector(): void {
        if (this.isTabHidden || !this.prefs.music || this.prefs.musicVolume <= 0) {
            this.director.setScene('silent', 0);
            return;
        }

        if (this.appState === 'dashboard') {
            const targetScene: MusicScene = this.queueingCount > 0 ? 'queueing' : 'lobby';
            this.director.setScene(targetScene, 0);
        } else {
            this.director.setScene(this.matchMood, this.matchUrgency);
        }
    }

    private wrapCallVolume(ctx: AudioContext, bus: AudioNode, volume?: number): AudioNode {
        if (volume === undefined || Math.abs(volume - 1) < 0.02) return bus;
        const g = ctx.createGain();
        g.gain.setValueAtTime(Math.max(0, Math.min(1.5, volume)), ctx.currentTime);
        g.connect(bus);
        setTimeout(() => {
            try {
                g.disconnect();
            } catch {
                /* ignore */
            }
        }, 2500);
        return g;
    }
}

function clampPct(val: number): number {
    if (!Number.isFinite(val)) return 75;
    return Math.max(0, Math.min(100, Math.round(val)));
}

let singletonEngine: SoundEngine | null = null;

export function getSoundEngine(): SoundEngine {
    if (!singletonEngine) {
        singletonEngine = new SoundEngine();
    }
    return singletonEngine;
}
