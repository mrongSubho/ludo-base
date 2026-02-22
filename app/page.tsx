"use client";
import Image from "next/image";
import styles from "./page.module.css";
import { Wallet, ConnectWallet } from "@coinbase/onchainkit/wallet";

export default function Home() {
  return (
    <div className={styles.container}>
      {/* 1. TOP BAR: Wallet Connection */}
      <header className={styles.headerWrapper} style={{ display: 'flex', justifyContent: 'flex-end', padding: '1rem' }}>
        <Wallet>
          <ConnectWallet />
        </Wallet>
      </header>

      {/* 2. CENTER: Ludo Logo & Welcome */}
      <div className={styles.content} style={{ textAlign: 'center', marginTop: '2rem' }}>
        <Image
          priority
          src="/sphere.svg" // Replace this later with a Ludo Dice icon!
          alt="Ludo Base Logo"
          width={150}
          height={150}
        />
        <h1 className={styles.title} style={{ fontSize: '2.5rem', color: '#0052FF' }}>
          Ludo Base Superstar
        </h1>
        <p style={{ fontSize: '1.1rem', marginBottom: '2rem' }}>
          Roll the dice onchain. Win $DEGEN.
        </p>

        {/* 3. ACTION: Start Game Button */}
        <button
          onClick={() => alert("Game Engine Loading...")}
          style={{
            padding: '15px 40px',
            fontSize: '1.2rem',
            backgroundColor: '#0052FF',
            color: 'white',
            border: 'none',
            borderRadius: '12px',
            cursor: 'pointer',
            fontWeight: 'bold'
          }}
        >
          PLAY NOW
        </button>

        {/* 4. FOOTER: Quick Links */}
        <div style={{ marginTop: '3rem' }}>
          <h2 className={styles.componentsTitle}>Game Assets</h2>
          <ul className={styles.components} style={{ listStyle: 'none', padding: 0 }}>
            <li><a href="#">Leaderboard</a></li>
            <li><a href="#">My NFTs</a></li>
          </ul>
        </div>
      </div>
    </div>
  );
}