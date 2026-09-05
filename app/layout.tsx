import { Metadata } from 'next';
import './globals.css';
import { Providers } from './Providers';
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

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const theme = cookieStore.get('ludo-theme')?.value;

  // Two themes: Retro-Futurism (default, dark) and Daybreak (soft-UI light).
  // Legacy 'dark'/'ui' cookies migrate to Retro-Futurism; legacy 'porcelain'
  // cookies migrate to Daybreak.
  let themeClass = 'theme-retro-futurism'; // Default
  if (theme === 'light' || theme === 'porcelain') themeClass = 'theme-daybreak';
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0" />
      </head>
      <body className={themeClass} suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}