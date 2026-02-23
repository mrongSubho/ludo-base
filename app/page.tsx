'use client';

export default function Page() {
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
      <p>Deployment Successful!</p>
      <button
        onClick={() => alert('Rolling...')}
        style={{ padding: '10px 20px', borderRadius: '8px', border: 'none', cursor: 'pointer' }}
      >
        Roll Dice
      </button>
    </div>
  );
}