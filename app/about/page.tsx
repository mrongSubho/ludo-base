import React from 'react';
import { ArenaDocShell } from '@/app/components/ArenaDocShell';
import { AboutContent } from '@/app/components/ArenaDocContent';

export const metadata = {
    title: 'About · Ludo 3077',
    description:
        'Learn how Ludo 3077 works in plain English. Classic Ludo, fair dice, Power Tiles, and easy Base rewards.',
};

export default function AboutPage() {
    return (
        <ArenaDocShell
            activePage="about"
            kicker="// ABOUT LUDO 3077"
            title="Classic Ludo, built for a new arena"
            subtitle="Ludo 3077 is a fast board game you can play right in your browser. Roll the dice, race your four pieces home, and outsmart your rivals."
            metaBadge="Novice Guide"
            maxWidth="wide"
        >
            <AboutContent layout="wide" />
        </ArenaDocShell>
    );
}
