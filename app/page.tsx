'use client'; // Essential for client-side rendering

import { useEffect, useState } from 'react';

export default function Page() {
  const [isMounted, setIsMounted] = useState(false);

  // This ensures the code only runs after the page is fully loaded in the browser,
  // preventing the "Hydration Error" that crashes Base's validator.
  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return <div style={{ backgroundColor: '#0052FF', height: '100vh' }} />;
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      backgroundColor: '#0052FF',
      color: 'white',
      fontFamily: 'sans-serif'
    }}>
      <h1>🎲 Ludo Base Superstar</h1>
      <p>Status: Online & Verified</p>
      <div style={{ marginTop: '20px', padding: '10px', border: '1px solid white' }}>
        Frame Ready for Base
      </div>
    </div>
  );
}