export interface ProgressionInfo {
    level: number;
    currentXp: number;
    xpToNextLevel: number;
    progressPercentage: number;
    tier: string;
    subRank: string;
    rating: number;
}

export const calculateLevel = (xp: number = 0): { level: number; progress: number; xpInLevel: number; nextLevelXp: number } => {
    // Level = floor(sqrt(xp / 100)) + 1
    const level = Math.floor(Math.sqrt(xp / 100)) + 1;
    
    // XP for current level start: (level - 1)^2 * 100
    const currentLevelStartXp = Math.pow(level - 1, 2) * 100;
    // XP for next level start: level^2 * 100
    const nextLevelStartXp = Math.pow(level, 2) * 100;
    
    const xpInLevel = xp - currentLevelStartXp;
    const xpNeededForLevel = nextLevelStartXp - currentLevelStartXp;
    const progress = (xpInLevel / xpNeededForLevel) * 100;

    return {
        level,
        progress: Math.min(100, Math.max(0, progress)),
        xpInLevel,
        nextLevelXp: xpNeededForLevel
    };
};

export const getTierInfo = (rating: number = 0): { tier: string; subRank: string; color: string } => {
    if (rating >= 5001) return { tier: 'Arena Master', subRank: '', color: 'from-orange-400 to-red-600' };
    if (rating >= 3001) return { tier: 'Diamond', subRank: '', color: 'from-cyan-300 to-blue-500' };
    
    const tiers = [
        { name: 'Platinum', min: 1801, max: 3000, color: 'from-blue-400 to-indigo-600' },
        { name: 'Gold', min: 901, max: 1800, color: 'from-yellow-400 to-orange-500' },
        { name: 'Silver', min: 301, max: 900, color: 'from-slate-300 to-gray-500' },
        { name: 'Bronze', min: 0, max: 300, color: 'from-amber-600 to-orange-800' }
    ];

    const currentTier = tiers.find(t => rating >= t.min && rating <= t.max) || tiers[3];
    const range = currentTier.max - currentTier.min;
    const step = range / 3;
    
    let subRank = 'III';
    if (rating >= currentTier.min + step * 2) subRank = 'I';
    else if (rating >= currentTier.min + step) subRank = 'II';

    return { tier: currentTier.name, subRank, color: currentTier.color };
};

export const getProgression = (xp: number = 0, rating: number = 0): ProgressionInfo => {
    const levelInfo = calculateLevel(xp);
    const tierInfo = getTierInfo(rating);
    
    return {
        level: levelInfo.level,
        currentXp: levelInfo.xpInLevel,
        xpToNextLevel: levelInfo.nextLevelXp,
        progressPercentage: levelInfo.progress,
        tier: tierInfo.tier,
        subRank: tierInfo.subRank,
        rating
    };
};
