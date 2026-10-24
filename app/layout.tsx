import { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from './Providers';
import { fontVariables } from './fonts';
import { cookies } from 'next/headers';

const APP_URL = 'https://ludo-base.vercel.app';

export const metadata: Metadata = {
  title: 'Ludo Base : The Onchain Arena',
  description: 'A Ludo game built on Base',
  openGraph: {
    title: 'Ludo Base : The Onchain Arena',
    description: 'A Ludo game built on Base',
    images: [`${APP_URL}/og-image.png`],
  },
  other: {
    // Farcaster Frame v2
    'fc:frame': JSON.stringify({
      version: "next",
      imageUrl: `${APP_URL}/og-image.png`,
      button: {
        title: "Play Ludo",
        action: {
          type: "launch_frame",
          name: "Ludo Base : The Onchain Arena",
          url: APP_URL,
          splashImageUrl: `${APP_URL}/og-image.png`,
          splashBackgroundColor: "#F8FAFC",
        },
      },
    }),
    'fc:frame:image:aspect_ratio': '1:1',
    'base:app_id': '699c46f96a71d5dab092bfb0',
  },
};

// REA-15: the manual <meta name="viewport"> in the body is deleted. Keeping
// both meant two viewport tags, and the browser honours the FIRST one — the
// hardcoded one — so this export was inert. `maximumScale` +
// `interactiveWidget` move here, where Next actually emits and controls them.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const theme = cookieStore.get('ludo-theme')?.value;
  const tokenStyle = cookieStore.get('token-style')?.value;

  // Two themes: Retro-Futurism (default, dark) and Daybreak (soft-UI light).
  // Legacy 'dark'/'ui' cookies migrate to Retro-Futurism; legacy 'porcelain'
  // cookies migrate to Daybreak.
  let themeClass = 'theme-retro-futurism'; // Default
  if (theme === 'light' || theme === 'porcelain') themeClass = 'theme-daybreak';

  // Orb is the DEFAULT token style: the class must be on <body> at first
  // paint, or `board.css`'s `body.token-style-orb .ludo-token svg` never hides
  // the chess pawns and every fresh visitor saw them despite orb being the
  // default. Only an explicit 'pawn' cookie suppresses it. The client
  // re-asserts this in usePreferences' mount effect.
  const tokenClass = tokenStyle === 'pawn' ? '' : ' token-style-orb';
    return (
        <html lang="en" className={fontVariables}>
            <head>
            </head>
            <body className={`${themeClass}${tokenClass}`} suppressHydrationWarning>
                <Providers>{children}</Providers>
            </body>
        </html>
    );
}