# WebTransport-First Competitive Multiplayer Architecture

## Executive Summary

This design implements a hybrid multiplayer architecture for Ludo Base that prioritizes competitive integrity by using WebTransport for matchmaking infrastructure while maintaining PeerJS for gameplay. This approach delivers sub-20ms matchmaking latency with 100% browser compatibility through automatic fallback mechanisms.

## Architecture Overview

### Hybrid Model: WebTransport + PeerJS

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Player 1      │    │   Edge Server    │    │   Player 2      │
│                 │    │                  │    │                 │
│ ┌─────────────┐ │    │                  │    │ ┌─────────────┐ │
│ │WebTransport │◄├────┤► Matchmaking    │◄────┤►│WebTransport │ │
│ │  (Edge)     │ │    │  Validation      │    │ │  (Edge)     │ │
│ └─────┬───────┘ │    │  Anti-Cheat      │    │ └─────┬───────┘ │
│       │         │    │  Wager Escrow    │    │       │         │
│ ┌─────▼───────┐ │    │                  │    │ ┌─────▼───────┐ │
│ │   PeerJS    │◄├────┤► Game Token      ◄────┤►│   PeerJS    │ │
│ │  (P2P)      │ │    │  Player List     │    │ │  (P2P)      │ │
│ └─────────────┘ │    │  Quality Info    │    │ └─────────────┘ │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

### Key Principles

1. **Competitive Integrity First**: All competitive modes use server-validated matchmaking
2. **Universal Compatibility**: Automatic fallback ensures 100% browser support
3. **Performance Optimized**: WebTransport for time-critical operations, PeerJS for stable gameplay
4. **Cost Effective**: Minimal server resources with edge computing

## Technical Architecture

### Connection Manager

```typescript
class CompetitiveConnection {
  private matchmakingTransport: WebTransport | null = null;
  private gameplayPeer: Peer | null = null;
  private currentMode: 'webtransport' | 'p2p-fallback' = 'webtransport';

  async connect(options: ConnectionOptions): Promise<ConnectionResult> {
    try {
      // Phase 1: WebTransport Matchmaking
      const match = await this.establishWebTransportMatch(options);

      // Phase 2: P2P Gameplay Connection
      await this.establishPeerJSGame(match);

      return {
        mode: 'webtransport',
        matchId: match.id,
        players: match.players,
        latency: match.estimatedLatency
      };
    } catch (error) {
      // Automatic fallback to P2P-only mode
      console.log('WebTransport failed, falling back to P2P:', error);
      return this.fallbackToP2P(options);
    }
  }

  private async establishWebTransportMatch(options: ConnectionOptions): Promise<Match> {
    // Connect to nearest edge server
    const edgeUrl = await this.selectOptimalEdgeServer();
    this.matchmakingTransport = new WebTransport(edgeUrl);

    // Authenticate and join matchmaking queue
    const authToken = await this.authenticatePlayer();
    const matchRequest = {
      playerId: options.playerId,
      gameMode: options.gameMode,
      matchType: options.matchType,
      wager: options.wager,
      skillRating: options.skillRating,
      region: edgeUrl.region
    };

    const match = await this.sendMatchmakingRequest(matchRequest);
    return this.validateMatch(match);
  }

  private async establishPeerJSGame(match: Match): Promise<void> {
    // Create or join P2P room based on match assignment
    if (match.isHost) {
      await this.hostP2PGame(match);
    } else {
      await this.joinP2PGame(match);
    }
  }
}
```

### Edge Server Implementation

```typescript
// Edge server handler (Deno Deploy/Cloudflare Workers)
export class CompetitiveMatchServer {
  private matchmakingQueue: MatchmakingQueue;
  private activeMatches: Map<string, ActiveMatch>;

  async handleWebTransportConnection(session: WebTransportSession) {
    const stream = await session.createBidirectionalStream();
    const reader = stream.readable.getReader();
    const writer = stream.writable.getWriter();

    try {
      while (true) {
        const { value } = await reader.read();
        if (!value) break;

        const message = JSON.parse(value);
        await this.handleMessage(message, writer);
      }
    } finally {
      reader.releaseLock();
      writer.releaseLock();
    }
  }

  private async handleMatchmakingRequest(request: MatchRequest): Promise<MatchResponse> {
    // Validate player eligibility
    await this.validatePlayerEligibility(request);

    // Check wager requirements
    await this.validateWager(request.playerId, request.wager);

    // Find suitable opponents
    const opponents = await this.findOpponents(request);

    // Create validated match
    const match = await this.createValidatedMatch(request, opponents);

    // Return match details and P2P connection info
    return {
      matchId: match.id,
      players: match.players,
      roomCode: match.roomCode,
      isHost: match.hostId === request.playerId,
      gameToken: match.gameToken,
      estimatedLatency: match.estimatedLatency
    };
  }
}
```

## Game Flow Implementation

### 1. Quick Match Flow

```typescript
// QuickMatchPanel.tsx
const QuickMatchPanel = ({ gameMode, matchType, wager }: Props) => {
  const connection = useCompetitiveConnection();

  const startQuickMatch = async () => {
    try {
      setStatus('connecting');

      const result = await connection.connect({
        mode: 'quick',
        gameMode,
        matchType,
        wager
      });

      if (result.mode === 'webtransport') {
        trackEvent('competitive_match_webtransport');
      } else {
        trackEvent('competitive_match_p2p_fallback');
      }

      // Proceed to game with validated match
      joinGame(result.matchId);

    } catch (error) {
      handleConnectionError(error);
    }
  };
};
```

### 2. Multiplayer Match (With Friends) Flow

```typescript
// MultiplayerMatchPanel.tsx - Host path
const hostCompetitiveMatch = async () => {
  const connection = useCompetitiveConnection();

  // Get validated room configuration from edge server
  const roomConfig = await connection.createValidatedRoom({
    gameMode,
    matchType,
    wager,
    friends: invitedFriends
  });

  // Host P2P game with server validation
  await connection.hostValidatedGame(roomConfig);
};

// Guest joins through edge server validation
const joinCompetitiveMatch = async (roomCode: string) => {
  const connection = useCompetitiveConnection();

  // Validate room code and join through edge server
  const result = await connection.joinValidatedRoom(roomCode);

  if (result.isValid) {
    joinGame(result.matchId);
  } else {
    showError('Invalid or expired room code');
  }
};
```

## Competitive Integrity Features

### 1. Server-Side Validation

```typescript
interface ValidationRules {
  gameConfig: GameConfigValidation;
  playerEligibility: PlayerEligibilityCheck;
  wagerIntegrity: WagerValidation;
  antiCheat: AntiCheatValidation;
}

class CompetitiveValidator {
  async validateGameConfig(config: GameConfig): Promise<ValidationResult> {
    // Ensure fair board setup
    // Validate random seed for dice rolls
    // Check for modified game rules
  }

  async validatePlayerEligibility(playerId: string): Promise<boolean> {
    // Check player rating and match history
    // Validate wallet connection for wagers
    // Check for active suspensions
  }

  async validateWagerIntegrity(wager: number, playerId: string): Promise<boolean> {
    // Verify sufficient balance
    // Lock wager amount
    // Ensure fair distribution
  }
}
```

### 2. Anti-Cheat Measures

```typescript
class AntiCheatSystem {
  private moveHistory: Move[] = [];
  private anomalyDetector: AnomalyDetector;

  validateMove(move: GameMove, gameState: GameState): ValidationResult {
    // Check move legality
    if (!this.isLegalMove(move, gameState)) {
      return { valid: false, reason: 'Illegal move' };
    }

    // Detect impossible dice rolls
    if (this.isImpossibleRoll(move.diceRoll, moveHistory)) {
      return { valid: false, reason: 'Impossible dice roll' };
    }

    // Check for timing anomalies
    if (this.isTimingAnomaly(move)) {
      return { valid: false, reason: 'Timing anomaly detected' };
    }

    return { valid: true };
  }

  private isImpossibleRoll(roll: number, history: Move[]): boolean {
    // Check for three 6's rule violation
    // Validate roll distribution
    // Detect manipulated random number generation
  }
}
```

### 3. Skill-Based Matchmaking

```typescript
interface MatchmakingAlgorithm {
  findOpponents(request: MatchRequest): Promise<Player[]>;
  calculateWaitTime(skillRating: number): number;
  expandSearchCriteria(currentCriteria: SearchCriteria): SearchCriteria;
}

class CompetitiveMatchmaker implements MatchmakingAlgorithm {
  async findOpponents(request: MatchRequest): Promise<Player[]> {
    const queue = await this.getSkillBasedQueue(request.skillRating);

    // Find players within rating range
    const candidates = queue.filter(player =>
      Math.abs(player.skillRating - request.skillRating) <= this.ratingThreshold
    );

    // Apply additional filters
    const filtered = this.applyFilters(candidates, {
      region: request.region,
      wager: request.wager,
      gameMode: request.gameMode
    });

    // Sort by best match
    return this.sortByMatchQuality(filtered, request);
  }

  private calculateMatchQuality(player: Player, request: MatchRequest): number {
    // Rating difference weight: 60%
    // Geographic distance weight: 20%
    // Connection quality weight: 20%
    return (ratingScore * 0.6) + (distanceScore * 0.2) + (connectionScore * 0.2);
  }
}
```

## Fallback Strategy

### Automatic Fallback Detection

```typescript
class ConnectionFallback {
  async shouldFallback(error: ConnectionError): Promise<FallbackReason> {
    // Check browser support
    if (!this.supportsWebTransport()) {
      return { shouldFallback: true, reason: 'browser-unsupported' };
    }

    // Check network conditions
    if (await this.isCorporateNetwork()) {
      return { shouldFallback: true, reason: 'corporate-firewall' };
    }

    // Check for repeated failures
    if (this.failureCount > 3) {
      return { shouldFallback: true, reason: 'repeated-failures' };
    }

    return { shouldFallback: false };
  }

  async executeFallback(options: ConnectionOptions): Promise<ConnectionResult> {
    // Notify player of fallback
    this.notifyFallback();

    // Use P2P-only matchmaking
    return this.p2pMatchmaker.findMatch(options);
  }
}
```

### Fallback User Experience

```typescript
const FallbackNotification = () => (
  <div className="competitive-fallback-notice">
    <Icon name="shield-check" />
    <span>Playing on standard servers due to connection type</span>
    <Tooltip>
      Competitive integrity maintained through server validation
    </Tooltip>
  </div>
);
```

## Performance Metrics

### Target Performance

| Metric | WebTransport | PeerJS Fallback | Target |
|--------|--------------|-----------------|---------|
| Matchmaking Latency | 15-30ms | 50-100ms | <100ms |
| Gameplay Latency | 20-50ms (P2P) | 20-50ms (P2P) | <50ms |
| Connection Success Rate | 85% | 95% | >99% |
| Anti-cheat Validation | Server-side | Reduced | Full |

### Monitoring

```typescript
interface PerformanceMetrics {
  connectionTime: number;
  matchmakingTime: number;
  fallbackRate: number;
  connectionType: 'webtransport' | 'p2p-fallback';
  region: string;
}

class CompetitiveMetrics {
  trackConnectionAttempt(metrics: PerformanceMetrics) {
    // Send to analytics
    analytics.track('competitive_connection', metrics);

    // Check for issues
    if (metrics.fallbackRate > 0.3) {
      this.alertHighFallbackRate(metrics.region);
    }
  }
}
```

## Deployment Strategy

### Phase 1: Core Implementation (Week 1-2)
1. Implement WebTransport connection manager
2. Deploy edge servers to 3 regions
3. Create fallback mechanisms
4. Integrate with existing UI

### Phase 2: Competitive Features (Week 3-4)
1. Implement anti-cheat validation
2. Add skill-based matchmaking
3. Integrate wager validation
4. Add comprehensive monitoring

### Phase 3: Optimization (Week 5-6)
1. Optimize edge server performance
2. Fine-tune fallback thresholds
3. Add regional expansion
4. Performance optimization

## Risk Mitigation

### Technical Risks
- **WebTransport adoption**: Monitor browser support, ready to increase fallback
- **Edge server costs**: Implement auto-scaling and usage limits
- **Complexity**: Maintain clear separation between connection types

### Competitive Risks
- **Player acceptance**: Clear communication about competitive benefits
- **Latency concerns**: Transparent metrics and fallback explanations
- **Fairness perception**: Visible anti-cheat measures and validation

## Success Criteria

1. **Performance**: <50ms average matchmaking time for 90% of players
2. **Reliability**: >99% connection success rate with fallback
3. **Integrity**: Zero successful cheating attempts in competitive modes
4. **Adoption**: >80% of competitive matches use WebTransport
5. **Satisfaction**: Player-reported fair matchmaking >4.5/5

This architecture positions Ludo Base as a premium competitive platform while maintaining universal accessibility through intelligent fallback mechanisms.