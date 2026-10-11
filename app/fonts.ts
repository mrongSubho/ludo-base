import { Inter, Inter_Tight, Chakra_Petch, Russo_One } from 'next/font/google';

/**
 * Self-hosted webfonts.
 *
 * These were previously three separate `@import url('https://fonts.googleapis.com/…')`
 * calls in globals.css. That chain cost three render-blocking cross-origin
 * requests (and a pile of woff2 downloads from a third-party origin Cloudflare
 * cannot cache for us) — it was the single biggest render-blocking cost on the
 * document. `next/font` self-hosts the files at build time so they are served
 * from our own origin, preloaded, and cacheable by Cloudflare like any other
 * hashed asset. Same families, same weights, same typography.
 */
export const inter = Inter({
    subsets: ['latin'],
    display: 'swap',
    weight: ['400', '500', '600', '700'],
    variable: '--font-inter',
});

export const interTight = Inter_Tight({
    subsets: ['latin'],
    display: 'swap',
    weight: ['500', '600', '700', '800'],
    variable: '--font-inter-tight',
});

export const chakraPetch = Chakra_Petch({
    subsets: ['latin'],
    display: 'swap',
    weight: ['300', '400', '500', '600', '700'],
    variable: '--font-chakra',
});

export const russoOne = Russo_One({
    subsets: ['latin'],
    display: 'swap',
    weight: ['400'],
    variable: '--font-russo',
});

/** Applies every font CSS variable to the document root. */
export const fontVariables = [
    inter.variable,
    interTight.variable,
    chakraPetch.variable,
    russoOne.variable,
].join(' ');
