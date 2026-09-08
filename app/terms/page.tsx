import React from 'react';
import Link from 'next/link';

export const metadata = {
    title: 'Terms of Service · Ludo Base',
    description: 'Terms of Service for the Ludo Base onchain arena.',
};

// ─── Terms of Service (concise, plain-language) ──────────────────────────────
export default function TermsPage() {
    return (
        <main className="min-h-[100dvh] flex items-start sm:items-center justify-center px-4 py-10 bg-black">
            <article className="w-full max-w-[560px] rounded-[28px] border border-white/10 bg-[#0d0d15]/95 px-6 py-8 sm:px-9 shadow-2xl">
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-cyan-300">
                    Ludo Base · Arena Entrance
                </p>
                <h1 className="mt-2 text-2xl font-black text-white uppercase tracking-tight">
                    Terms of Service
                </h1>
                <p className="mt-1 text-[11px] font-bold text-white/40">
                    Last updated: September 2026
                </p>

                <div className="mt-6 flex flex-col gap-4 text-[13px] leading-relaxed text-white/70 font-medium">
                    <section>
                        <h2 className="text-sm font-black text-white uppercase tracking-widest">1. The game</h2>
                        <p className="mt-1">
                            Ludo Base is a skill-and-chance board arena. Matches run on provably-fair
                            dice, and entry fees are paid in virtual Coins. Where onchain settlement
                            applies, results are recorded on the connected network and are final.
                        </p>
                    </section>
                    <section>
                        <h2 className="text-sm font-black text-white uppercase tracking-widest">2. Eligibility</h2>
                        <p className="mt-1">
                            You must be at least 18 years old (or the age of majority where you live)
                            to play matches with entry fees. Free practice matches, including guest
                            play against AI, carry no stakes.
                        </p>
                    </section>
                    <section>
                        <h2 className="text-sm font-black text-white uppercase tracking-widest">3. Your account</h2>
                        <p className="mt-1">
                            Your wallet is your identity. Keep it secure — anyone holding your keys
                            controls your coins, rank, and collectibles. Guest passes are local to
                            your device and can be migrated to a wallet at any time.
                        </p>
                    </section>
                    <section>
                        <h2 className="text-sm font-black text-white uppercase tracking-widest">4. Fair play</h2>
                        <p className="mt-1">
                            Bots, exploits, match-fixing, multi-account farming, and any interference
                            with dice, matchmaking, or payouts lead to forfeited rewards and account
                            suspension. Stakes from voided matches may be returned at our discretion.
                        </p>
                    </section>
                    <section>
                        <h2 className="text-sm font-black text-white uppercase tracking-widest">5. Virtual items</h2>
                        <p className="mt-1">
                            Coins, ranks, avatars, and relics have no cash value unless an explicit
                            cash-out feature states otherwise. Balances can be adjusted to reverse
                            fraud, bugs, or duplicate payouts.
                        </p>
                    </section>
                    <section>
                        <h2 className="text-sm font-black text-white uppercase tracking-widest">6. Availability</h2>
                        <p className="mt-1">
                            The arena is provided as-is. Matches, streams, and payouts depend on
                            third-party networks and may pause or fail; we are not liable for lost
                            stakes beyond a good-faith refund where technically possible.
                        </p>
                    </section>
                </div>

                <Link
                    href="/"
                    className="mt-8 flex items-center justify-center w-full py-3.5 rounded-2xl bg-white text-black text-xs font-black uppercase tracking-[0.2em] hover:bg-white/90 active:scale-[0.99] transition-all"
                >
                    Back to entrance
                </Link>
            </article>
        </main>
    );
}
