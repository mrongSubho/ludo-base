#!/usr/bin/env node
/**
 * WCAG 2.1 contrast checker — UI_DESIGN_AUDIT.md Appendix C.
 *
 * Usage:
 *   node scripts/contrast.mjs <fg> <bg>     # one pair
 *   node scripts/contrast.mjs --pairs       # assert every documented pair
 *
 * The --pairs mode is the gate: it exits non-zero when a pair that is used for
 * required text drops below 4.5:1 (3.0:1 is the UI/large-text threshold, and
 * pairs marked "decorative" in the audit are not asserted at all).
 */

const lum = (h) => {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/** Documented pairs (UI_DESIGN_AUDIT.md §4). `min` is the WCAG threshold. */
const PAIRS = [
  // Retro-Futurism (dark, default)
  { fg: '#E2E8F0', bg: '#0F0F23', min: 4.5, what: 'Retro primary ink on page' },
  { fg: '#94A3B8', bg: '#12122b', min: 4.5, what: 'Retro muted ink on panel' },
  { fg: '#22D3EE', bg: '#12122b', min: 4.5, what: 'Retro accent on panel' },
  { fg: '#E2E8F0', bg: '#334155', min: 4.5, what: 'Retro ink on board path' },
  { fg: '#fbbf24', bg: '#12122b', min: 4.5, what: 'Retro warn on panel' },
  { fg: '#4ade80', bg: '#12122b', min: 4.5, what: 'Retro positive on panel' },
  { fg: '#f87171', bg: '#12122b', min: 4.5, what: 'Retro negative on panel' },
  // Daybreak (light)
  { fg: '#0f172a', bg: '#e6e8ec', min: 4.5, what: 'Daybreak primary ink on page' },
  { fg: '#475569', bg: '#ffffff', min: 4.5, what: 'Daybreak muted ink on white panel' },
  { fg: '#0d6d87', bg: '#e6e8ec', min: 4.5, what: 'Daybreak accent on page (was #0e7490 = 4.37, FAIL)' },
  { fg: '#0d6d87', bg: '#ffffff', min: 4.5, what: 'Daybreak accent on white panel' },
  // The audit's §5.2 proposal for these three FAILED on the page background when
  // actually measured (#b45309 4.09 · #15803d 4.09 · #dc2626 3.94). Phase 2 must
  // ship these corrected values instead.
  { fg: '#92400e', bg: '#e6e8ec', min: 4.5, what: 'Daybreak warn on page (audit proposed #b45309 = 4.09, FAIL)' },
  { fg: '#166534', bg: '#e6e8ec', min: 4.5, what: 'Daybreak positive on page (audit proposed #15803d = 4.09, FAIL)' },
  { fg: '#b91c1c', bg: '#e6e8ec', min: 4.5, what: 'Daybreak negative on page (audit proposed #dc2626 = 3.94, FAIL)' },
  // UI / large text (3.0 threshold)
  { fg: '#0d6d87', bg: '#ffffff', min: 3.0, what: 'Daybreak accent as UI/border on white' },
];

const argv = process.argv.slice(2);

if (argv[0] === '--pairs') {
  let failures = 0;
  for (const p of PAIRS) {
    const r = ratio(p.fg, p.bg);
    const ok = r >= p.min;
    if (!ok) failures++;
    console.log(`${ok ? '✓' : '✗'} ${r.toFixed(2)}:1 (min ${p.min})  ${p.fg} on ${p.bg} — ${p.what}`);
  }
  if (failures > 0) {
    console.log(`✗ contrast gate failed: ${failures} pair(s) below threshold`);
    process.exit(1);
  }
  console.log(`✓ contrast gate clean (${PAIRS.length} pairs)`);
} else if (argv.length === 2) {
  console.log(`${argv[0]} on ${argv[1]} = ${ratio(argv[0], argv[1]).toFixed(2)}:1`);
} else {
  console.error('usage: node scripts/contrast.mjs <fg> <bg> | --pairs');
  process.exit(2);
}
