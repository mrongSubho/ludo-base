/**
 * Shared pure-JS profanity & abuse filter (`DirtySvr` equivalent).
 * Safe for both Next.js API routes and Cloudflare Durable Objects (`MatchRoomCore`).
 * Uses whole-word boundary matching so normal gaming terms (`classic`, `pass`, etc.)
 * are never masked.
 */

const BLOCKED_TERMS: readonly string[] = [
    'fuck',
    'fucker',
    'fucking',
    'shit',
    'bullshit',
    'bitch',
    'bitches',
    'asshole',
    'bastard',
    'cunt',
    'dickhead',
    'motherfucker',
    'nigger',
    'nigga',
    'faggot',
    'fag',
    'retard',
    'retarded',
    'kys',
    'whore',
    'slut',
];

const PHRASE_PATTERNS: readonly RegExp[] = [
    /\bseed\s+phrase\b/gi,
    /\bprivate\s+key\b/gi,
    /\brecovery\s+phrase\b/gi,
    /\bkill\s+your\s*self\b/gi,
];

function escapeRegex(term: string): string {
    return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const WORD_REGEX = new RegExp(`\\b(${BLOCKED_TERMS.map(escapeRegex).join('|')})\\b`, 'gi');

export function containsProfanity(input: string): boolean {
    if (!input) return false;
    WORD_REGEX.lastIndex = 0;
    if (WORD_REGEX.test(input)) return true;
    for (const rx of PHRASE_PATTERNS) {
        rx.lastIndex = 0;
        if (rx.test(input)) return true;
    }
    return false;
}

export function filterProfanity(input: string): string {
    if (!input) return '';
    let out = input.replace(WORD_REGEX, (match) => '*'.repeat(Math.max(3, match.length)));
    for (const rx of PHRASE_PATTERNS) {
        out = out.replace(rx, (match) => '*'.repeat(Math.max(3, match.length)));
    }
    return out;
}
