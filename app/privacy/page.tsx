import React from 'react';
import Link from 'next/link';

export const metadata = {
    title: 'Privacy Policy · Ludo Base',
    description: 'Privacy Policy for the Ludo Base onchain arena.',
};

// ─── Privacy Policy (concise, plain-language) ────────────────────────────────
export default function PrivacyPage() {
    return (
        <main className="min-h-[100dvh] flex items-start sm:items-center justify-center px-4 py-10 bg-black">
            <article className="w-full max-w-[560px] rounded-[28px] border border-white/10 bg-[#0d0d15]/95 px-6 py-8 sm:px-9 shadow-2xl">
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-cyan-300">
                    Ludo Base · Arena Entrance
                </p>
                <h1 className="mt-2 text-2xl font-black text-white uppercase tracking-tight">
                    Privacy Policy
                </h1>
                <p className="mt-1 text-[11px] font-bold text-white/40">
                    Last updated: September 2026
                </p>

                <div className="mt-6 flex flex-col gap-4 text-[13px] leading-relaxed text-white/70 font-medium">
                    <section>
                        <h2 className="text-sm font-black text-white uppercase tracking-widest">1. What we store</h2>
                        <p className="mt-1">
                            Connected wallets: your public address, chosen username and avatar,
                            match history, coins, rank, and settings. Guests: everything stays on
                            your device (local storage) — no server account is created until you
                            connect a wallet.
                        </p>
                    </section>
                    <section>
                        <h2 className="text-sm font-black text-white uppercase tracking-widest">2. What we never touch</h2>
                        <p className="mt-1">
                            We never see or store your private keys or seed phrases. Wallet
                            signatures happen in your own wallet app, and we cannot move your
                            funds without your explicit approval.
                        </p>
                    </section>
                    <section>
                        <h2 className="text-sm font-black text-white uppercase tracking-widest">3. Public by design</h2>
                        <p className="mt-1">
                            Usernames, avatars, ranks, live matches, and onchain results are
                            visible to other players and spectators. Do not use personal
                            information as your display name.
                        </p>
                    </section>
                    <section>
                        <h2 className="text-sm font-black text-white uppercase tracking-widest">4. Analytics &amp; cookies</h2>
                        <p className="mt-1">
                            We use minimal device storage (theme, sound, token style, session
                            preferences) to make the arena work. No advertising trackers are
                            embedded in the game client.
                        </p>
                    </section>
                    <section>
                        <h2 className="text-sm font-black text-white uppercase tracking-widest">5. Your controls</h2>
                        <p className="mt-1">
                            Disconnect your wallet any time to stop new data collection. To erase
                            your stored profile and match history, contact support from the
                            Settings panel — onchain records, once settled, cannot be deleted by
                            anyone.
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
