"use client";

import React from 'react';
import { TokenPiece } from '@/app/components/BoardTokens';
import { getBoardCoordinate, ColorCorner } from '@/lib/boardLayout';
import { getIntermediatePathCoords } from '@/lib/gameLogic';

const CC: ColorCorner = { green: 'TL', red: 'TR', yellow: 'BR', blue: 'BL' };

export default function TokenMoveTestPage() {
    const [pos, setPos] = React.useState(0);
    const [log, setLog] = React.useState<string[]>([]);
    const logRef = React.useRef<HTMLPreElement>(null);

    const move = (dice: number) => {
        setPos(p => {
            const pts = getIntermediatePathCoords(p, Math.min(57, p + dice), 'green', CC);
            const next = Math.min(57, p + dice);
            setLog(l => [`roll=${dice}  ${p} → ${next}  cells=[${pts.map(pt => `${pt.r}:${pt.c}`).join(' | ')}]`, ...l].slice(0, 12));
            return next;
        });
    };

    React.useEffect(() => { if (logRef.current) logRef.current.scrollTop = 0; }, [log]);

    const tp = getBoardCoordinate(pos, 'green', CC);

    return (
        <div className="min-h-screen bg-[#101018] text-white p-6 flex gap-8">
            <div>
                <h1 className="text-lg font-bold mb-1">TOKEN MOVE LAB</h1>
                <p className="text-xs text-white/40 mb-4">Same TokenPiece code, zero game engine. Watch the green token.</p>
                <div className="flex gap-2 mb-4">
                    {[1, 2, 3, 4, 5, 6].map(d => (
                        <button
                            key={d}
                            onClick={() => move(d)}
                            className="w-10 h-10 rounded-lg bg-cyan-500/20 border border-cyan-400/40 font-bold hover:bg-cyan-500/40"
                        >{d}</button>
                    ))}
                    <button
                        onClick={() => { setPos(0); setLog([]); }}
                        className="px-3 h-10 rounded-lg bg-white/10 border border-white/20 text-sm"
                    >Reset</button>
                </div>
                <div
                    className="relative grid gap-0"
                    style={{ gridTemplateRows: 'repeat(15, 38px)', gridTemplateColumns: 'repeat(15, 38px)' }}
                >
                    {Array.from({ length: 225 }).map((_, i) => (
                        <div key={i} className="border border-white/10" style={{ gridRow: Math.floor(i / 15) + 1, gridColumn: (i % 15) + 1 }} />
                    ))}
                    {tp && (
                        <TokenPiece
                            color="green"
                            index={0}
                            pos={pos}
                            targetPt={tp}
                            offset={{ x: 0, y: 0 }}
                            isDraggable={false}
                            isColorTurn={true}
                            counterRotationDeg={0}
                            colorCorner={CC}
                            onClick={() => {}}
                        />
                    )}
                </div>
            </div>
            <div className="flex-1">
                <h2 className="text-sm font-bold text-white/60 mb-2">MOVE TRACE</h2>
                <pre ref={logRef} className="text-[11px] leading-5 bg-black/40 rounded-lg p-3 overflow-auto h-[70vh] whitespace-pre-wrap">
{log.length ? log.join('\n') : 'Click a dice button…'}
                </pre>
            </div>
        </div>
    );
}
