import { useState } from 'react';

interface Player {
    name: string;
    level: number;
    avatar: string;
    color: 'green' | 'red' | 'yellow' | 'blue';
    position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
    isAi?: boolean;
}

interface PlayerProfileSheetProps {
    player: Player | null;
    wins: number;
    onClose: () => void;
}

const COLOR_MAP: Record<string, string> = {
    green: 'linear-gradient(135deg, #7EC8A0, #5FA880)',
    red: 'linear-gradient(135deg, #D4847A, #B4645A)',
    yellow: 'linear-gradient(135deg, #E8C567, #C8A547)',
    blue: 'linear-gradient(135deg, #7BAFD4, #5B8FB4)',
};

// A stable "random" total based on player name (no re-render flicker)
function stableTotal(name: string, wins: number) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
    return wins + (h % 12) + 6;
}

export default function PlayerProfileSheet({ player, wins, onClose }: PlayerProfileSheetProps) {
    const [friendStatus, setFriendStatus] = useState<'none' | 'sent' | 'friends'>('none');
    const [dmSent, setDmSent] = useState(false);
    const [blocked, setBlocked] = useState(false);

    if (!player) return null;

    const totalGames = stableTotal(player.name, wins);
    const winRate = Math.round((wins / totalGames) * 100);

    // Position based on player side
    const isLeft = player.position.includes('left');
    const isTop = player.position.includes('top');
    const verticalAnchor = isTop ? { top: '60px' } : { bottom: '60px' };
    const horizAnchor = isLeft ? { left: '8px' } : { right: '8px' };

    const handleFriend = () => {
        if (friendStatus === 'none') setFriendStatus('sent');
        else if (friendStatus === 'sent') setFriendStatus('friends');
    };

    const handleDm = () => {
        setDmSent(true);
        setTimeout(() => setDmSent(false), 2000);
    };

    return (
        <>
            {/* Dim backdrop — very faint so board stays visible */}
            <div
                className="fixed top-[64px] bottom-[80px] left-0 right-0 bg-transparent z-[120]"
            />

            {/* Compact floating popup */}
            <div
                className="profile-popup relative"
                style={{
                    ...verticalAnchor,
                    ...horizAnchor,
                    background: 'var(--panel-bg-image, var(--ludo-bg-cosmic))',
                    backgroundColor: 'var(--panel-bg, rgba(13,13,13,0.92))',
                    backdropFilter: 'blur(32px)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '24px',
                    overflow: 'hidden',
                    zIndex: 130
                }}
            >
                {/* Coloured top strip + avatar */}
                <div className="pp-header" style={{ background: COLOR_MAP[player.color] }}>
                    <div className="pp-avatar">{player.avatar}</div>
                    <button className="pp-close" onClick={onClose} aria-label="Close player profile">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="w-3.5 h-3.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>

                {/* Name + level */}
                <div className="pp-identity">
                    <span className="pp-name">{player.name.slice(0, 12)}</span>
                    <span className="pp-lv">Lv.{player.level}</span>
                    {player.isAi && <span className="pp-ai-tag">AI</span>}
                </div>

                {/* Stats */}
                <div className="pp-stats">
                    <div className="pp-stat">
                        <strong>{wins}</strong>
                        <span>Wins</span>
                    </div>
                    <div className="pp-stat-div" />
                    <div className="pp-stat">
                        <strong>{totalGames}</strong>
                        <span>Games</span>
                    </div>
                    <div className="pp-stat-div" />
                    <div className="pp-stat">
                        <strong>{winRate}%</strong>
                        <span>W-Rate</span>
                    </div>
                </div>

                {/* Actions */}
                {!player.isAi ? (
                    <div className="pp-actions">
                        <button
                            className={`pp-btn ${friendStatus !== 'none' ? 'pp-btn-active' : ''}`}
                            onClick={handleFriend}
                            disabled={friendStatus === 'friends'}
                            title={friendStatus === 'none' ? 'Add Friend' : friendStatus === 'sent' ? 'Request sent' : 'Friends'}
                        >
                            {friendStatus === 'none' && (
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="20" y1="8" x2="20" y2="14"></line><line x1="23" y1="11" x2="17" y2="11"></line></svg>
                            )}
                            {friendStatus === 'sent' && (
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                            )}
                            {friendStatus === 'friends' && (
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><polyline points="20 6 9 17 4 12"></polyline></svg>
                            )}
                            <span>{friendStatus === 'none' ? 'Add' : friendStatus === 'sent' ? 'Pending' : 'Friends'}</span>
                        </button>

                        <button
                            className={`pp-btn ${dmSent ? 'pp-btn-active' : ''}`}
                            onClick={handleDm}
                        >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><circle cx="12" cy="12" r="4"></circle><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"></path></svg>
                            <span>{dmSent ? 'Sent!' : 'DM'}</span>
                        </button>

                        <button
                            className={`pp-btn pp-btn-danger ${blocked ? 'pp-btn-active-danger' : ''}`}
                            onClick={() => setBlocked(b => !b)}
                        >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>
                            <span>{blocked ? 'Unblock' : 'Block'}</span>
                        </button>
                    </div>
                ) : (
                    <p className="pp-ai-note">AI-controlled — actions disabled.</p>
                )}
            </div>
        </>
    );
}
