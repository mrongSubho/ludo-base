import type { MetadataRoute } from "next";

/** R5 — PWA manifest (SMART_WALLET_PLANNING). Base-only wallet + game shell. */
export default function manifest(): MetadataRoute.Manifest {
    return {
        name: "Ludo 3077 — The Onchain Arena",
        short_name: "Ludo 3077",
        description: "Play Ludo 3077 and manage your Base wallet",
        start_url: "/",
        display: "standalone",
        // Rotation lock for installed PWA: the OS keeps the app portrait.
        // (Browsers and in-app webviews ignore this — LandscapeGuard covers them.)
        orientation: "portrait",
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
