import { Metadata } from 'next';
import './globals.css'; // Keep your global styles

// This is your App's ID card for the Base ecosystem
export const metadata: Metadata = {
  other: {
    'base:app_id': '699a31ac49d3b2f3d407e958',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}