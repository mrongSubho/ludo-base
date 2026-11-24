import { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from './Providers';
import { fontVariables } from './fonts';
import { cookies } from 'next/headers';

const APP_URL = 'https://ludo-base.vercel.app';

export const metadata: Metadata = {
  title: 'Ludo 3077 : The Onchain Arena',
  description: 'A futuristic onchain Ludo arena built on Base',
  openGraph: {
    title: 'Ludo 3077 : The Onchain Arena',
    description: 'A futuristic onchain Ludo arena built on Base',
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
          name: "Ludo 3077 : The Onchain Arena",
          url: APP_URL,
          splashImageUrl: `${APP_URL}/og-image.png`,
          splashBackgroundColor: "#05070A",
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
  const motionPref = cookieStore.get('ludo-motion')?.value;

  // Three themes: 3077 (flagship cyber-tactical HUD, default), Retro-Futurism (dark), and Daybreak (soft-UI light).
  // Legacy 'dark'/'ui' cookies migrate to Retro-Futurism; legacy 'porcelain'
  // cookies migrate to Daybreak.
  let themeClass = 'theme-3077'; // Default flagship
  if (theme === 'retro' || theme === 'dark' || theme === 'ui') themeClass = 'theme-retro-futurism';
  else if (theme === 'light' || theme === 'porcelain') themeClass = 'theme-daybreak';

  // Orb is the DEFAULT token style: the class must be on <body> at first
  // paint, or `board.css`'s `body.token-style-orb .ludo-token svg` never hides
  // the chess pawns and every fresh visitor saw them despite orb being the
  // default. Only an explicit 'pawn' cookie suppresses it. The client
  // re-asserts this in usePreferences' mount effect.
  const tokenClass = tokenStyle === 'pawn' ? '' : ' token-style-orb';
  const motionClass =
    motionPref === 'full'
      ? ' motion-force-full'
      : motionPref === 'reduced'
        ? ' motion-force-reduced'
        : '';
    return (
        <html lang="en" className={fontVariables}>
            <head>
            </head>
            <body className={`${themeClass}${tokenClass}${motionClass}`} suppressHydrationWarning>
                <Providers>{children}</Providers>
            </body>
        </html>
    );
}