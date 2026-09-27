"use client";

import WcWalletPanel from "@/app/components/WcWalletPanel";

/** W5 — WalletConnect wallet deep link: /wc?uri=wc:… */
export default function WcPage() {
    return (
        <main className="min-h-screen p-8 flex flex-col items-start gap-4">
            <h1 className="text-lg font-bold uppercase tracking-widest text-white/80">
                Ludo wallet · WalletConnect
            </h1>
            <div className="w-full max-w-xl">
                <WcWalletPanel />
            </div>
        </main>
    );
}
