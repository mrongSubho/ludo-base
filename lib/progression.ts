export interface ProgressionInfo {
    level: number;
    currentLxp: number;
    lxpToNextLevel: number;
    progressPercentage: number;
    tier: string;
    subRank: string;
    rxp: number;
}

export const calculateLevel = (lxp: number = 0): { level: number; progress: number; lxpInLevel: number; nextLevelLxp: number } => {
    // Level = floor(sqrt(lxp / 100)) + 1
    const level = Math.floor(Math.sqrt(lxp / 100)) + 1;
    
    // LXP for current level start: (level - 1)^2 * 100
    const currentLevelStartLxp = Math.pow(level - 1, 2) * 100;
    // LXP for next level start: level^2 * 100
    const nextLevelStartLxp = Math.pow(level, 2) * 100;
    
    const lxpInLevel = lxp - currentLevelStartLxp;
    const lxpNeededForLevel = nextLevelStartLxp - currentLevelStartLxp;
    const progress = (lxpInLevel / lxpNeededForLevel) * 100;

    return {
        level,
        progress: Math.min(100, Math.max(0, progress)),
        lxpInLevel,
        nextLevelLxp: lxpNeededForLevel
    };
};

export const getTierInfo = (rxp: number = 0): { tier: string; subRank: string; color: string } => {
    if (rxp >= 5001) return { tier: 'Arena Master', subRank: '', color: 'from-orange-400 to-red-600' };
    if (rxp >= 3001) return { tier: 'Diamond', subRank: '', color: 'from-cyan-300 to-blue-500' };
    
    const tiers = [
        { name: 'Platinum', min: 1801, max: 3000, color: 'from-blue-400 to-indigo-600' },
        { name: 'Gold', min: 901, max: 1800, color: 'from-yellow-400 to-orange-500' },
        { name: 'Silver', min: 301, max: 900, color: 'from-slate-300 to-gray-500' },
        { name: 'Bronze', min: 0, max: 300, color: 'from-amber-600 to-orange-800' }
    ];

    const currentTier = tiers.find(t => rxp >= t.min && rxp <= t.max) || tiers[3];
    const range = currentTier.max - currentTier.min;
    const step = range / 3;
    
    let subRank = 'III';
    if (rxp >= currentTier.min + step * 2) subRank = 'I';
    else if (rxp >= currentTier.min + step) subRank = 'II';

    return { tier: currentTier.name, subRank, color: currentTier.color };
};

export const getProgression = (lxp: number = 0, rxp: number = 0): ProgressionInfo => {
    const levelInfo = calculateLevel(lxp);
    const tierInfo = getTierInfo(rxp);
    
    return {
        level: levelInfo.level,
        currentLxp: levelInfo.lxpInLevel,
        lxpToNextLevel: levelInfo.nextLevelLxp,
        progressPercentage: levelInfo.progress,
        tier: tierInfo.tier,
        subRank: tierInfo.subRank,
        rxp
    };
};

export interface RankProgress {
    pct: number;
    current: number;
    target: number | null;
    nextLabel: string;
}

/**
 * Progress of `rxp` (rank XP) toward the next tier.
 * Mirrors getTierInfo thresholds; open-ended top tiers report progress
 * within Diamond (3001–5000) and MAX for Arena Master.
 */
export const getRankProgress = (rxp: number = 0): RankProgress => {
    if (rxp >= 5001) return { pct: 100, current: rxp, target: null, nextLabel: 'MAX' };
    if (rxp >= 3001) return { pct: ((rxp - 3001) / 2000) * 100, current: rxp, target: 5001, nextLabel: 'Arena Master' };

    const tiers = [
        { name: 'Platinum', min: 1801, max: 3000, next: 'Diamond' },
        { name: 'Gold', min: 901, max: 1800, next: 'Platinum' },
        { name: 'Silver', min: 301, max: 900, next: 'Gold' },
        { name: 'Bronze', min: 0, max: 300, next: 'Silver' }
    ];

    const t = tiers.find(t => rxp >= t.min && rxp <= t.max) || tiers[3];
    return {
        pct: ((rxp - t.min) / (t.max - t.min)) * 100,
        current: rxp,
        target: t.max + 1,
        nextLabel: t.next
    };
};
