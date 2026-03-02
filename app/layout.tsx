import { Metadata } from 'next';
import './globals.css';
import { Providers } from './Providers';
import { ConnectButton } from '@rainbow-me/rainbowkit';

const APP_URL = 'https://ludo-base.vercel.app';

export const metadata: Metadata = {
  title: 'Ludo Base Superstar',
  description: 'A Ludo game built on Base',
  openGraph: {
    title: 'Ludo Base Superstar',
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
          name: "Ludo Base Superstar",
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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0" />
      </head>
      <body suppressHydrationWarning>
        <Providers>
          <div style={{ position: 'fixed', top: '20px', left: '20px', zIndex: 2147483647, backgroundColor: 'red', padding: '10px' }}>
            <ConnectButton />
          </div>
          {children}
        </Providers>
      </body>
    </html>
  );
}