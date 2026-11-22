import { useEffect, useSyncExternalStore } from 'react';

/**
 * Unified 3077 Deployment-Mode Theme Registry.
 * Drives the whole Ludo 3077 HUD palette (`--accent`, `--accent-rgb`,
 * `--accent-bright`, `--accent-ink`) from the active Action Dice mode:
 * - `quick`   (QUICK MATCH)   -> Hyper-Cyan
 * - `team`    (TEAM UP)       -> Solar Amber
 * - `offline` (OFFLINE MATCH) -> Matrix Emerald
 */

export type DeployModeId = 'quick' | 'team' | 'offline';

export interface DeployThemePalette {
    id: DeployModeId;
    label: string;
    hex: string;
    rgb: string;
    bright: string;
    edge: string;
    ink: string;
}

export const DEPLOY_MODE_STORAGE_KEY = 'ludo-last-mode';

export const DEPLOY_THEMES: Record<DeployModeId, DeployThemePalette> = {
    quick: {
        id: 'quick',
        label: 'QUICK MATCH',
        hex: '#00E5FF',
        rgb: '0, 229, 255',
        bright: '#7CEFFF',
        edge: '#67F3FF',
        ink: '#02090D',
    },
    team: {
        id: 'team',
        label: 'TEAM UP',
        hex: '#F59E0B',
        rgb: '245, 158, 11',
        bright: '#FCD34D',
        edge: '#FBBF24',
        ink: '#120902',
    },
    offline: {
        id: 'offline',
        label: 'OFFLINE MATCH',
        hex: '#00FF66',
        rgb: '0, 255, 102',
        bright: '#6EE7B7',
        edge: '#34D399',
        ink: '#021208',
    },
};

export function isDeployModeId(value: unknown): value is DeployModeId {
    return value === 'quick' || value === 'team' || value === 'offline';
}

export function readStoredDeployMode(): DeployModeId {
    try {
        if (typeof localStorage === 'undefined') return 'quick';
        const raw = localStorage.getItem(DEPLOY_MODE_STORAGE_KEY);
        return isDeployModeId(raw) ? raw : 'quick';
    } catch {
        return 'quick';
    }
}

let currentDeployMode: DeployModeId = 'quick';
const listeners = new Set<() => void>();

function notifyDeployListeners(): void {
    listeners.forEach((fn) => fn());
}

/** Sync active deployment mode to React subscribers and `body[data-deploy-mode]`. */
export function setDeployModeTheme(mode: DeployModeId, persist = true): void {
    const changed = currentDeployMode !== mode;
    currentDeployMode = mode;

    if (typeof document !== 'undefined' && document.body) {
        if (document.body.dataset.deployMode !== mode) {
            document.body.dataset.deployMode = mode;
        }
    }

    if (persist) {
        try {
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem(DEPLOY_MODE_STORAGE_KEY, mode);
            }
        } catch {
            /* ignore storage restrictions */
        }
    }

    if (changed) {
        notifyDeployListeners();
    }
}

function subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => {
        listeners.delete(cb);
    };
}

function getSnapshot(): DeployModeId {
    return currentDeployMode;
}

function getServerSnapshot(): DeployModeId {
    return 'quick';
}

/**
 * Subscribe to the live 3077 deployment-mode palette without triggering SSR
 * hydration mismatches (hydrates stored preference cleanly on mount).
 */
export function useDeployTheme(): { mode: DeployModeId; theme: DeployThemePalette } {
    const mode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

    useEffect(() => {
        const stored = readStoredDeployMode();
        if (typeof document !== 'undefined' && document.body && !document.body.dataset.deployMode) {
            document.body.dataset.deployMode = stored;
        }
        if (stored !== currentDeployMode) {
            currentDeployMode = stored;
            notifyDeployListeners();
        }
    }, []);

    return {
        mode,
        theme: DEPLOY_THEMES[mode],
    };
}
