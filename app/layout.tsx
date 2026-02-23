import { Metadata } from 'next';
import './globals.css';

const APP_URL = 'https://ludo-base.vercel.app';

export const metadata: Metadata = {
  title: 'Ludo Base Superstar',
  description: 'A Ludo game built on Base',
  openGraph: {
    title: 'Ludo Base Superstar',
    description: 'A Ludo game built on Base',
    images: [`${APP_URL}/og-image.png`], // Make sure you have an image in your public folder!
  },
  other: {
    // Keep your App ID
    'base:app_id': '699c46f96a71d5dab092bfb0',
    // Mandatory Frame v2 tags
    'fc:frame': 'vNext',
    'fc:frame:image': `${APP_URL}/og-image.png`,
    'fc:frame:button:1': 'Play Ludo',
    'fc:frame:post_url': `${APP_URL}/api/frame`,
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
      <body>{children}</body>
    </html>
  );
}