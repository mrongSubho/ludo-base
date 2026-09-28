import type { MetadataRoute } from "next";

/** R5 — PWA manifest (REAL_WALLET_PLAN). Base-only wallet + game shell. */
export default function manifest(): MetadataRoute.Manifest {
    return {
        name: "Ludo Base — The Onchain Arena",
        short_name: "Ludo Base",
        description: "Play Ludo and manage your Base wallet",
        start_url: "/",
        display: "standalone",
        background_color: "#0b0b12",
        theme_color: "#00E5FF",
        icons: [
            {
                src: "/ludo-base-logo.svg",
                sizes: "any",
                type: "image/svg+xml",
                purpose: "any",
            },
        ],
    };
}
