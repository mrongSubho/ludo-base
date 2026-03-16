// lib/teamup/peerjs-gameplay.ts
import Peer, { DataConnection } from 'peerjs';

export class PeerJSGameplay {
  private peer: Peer | null = null;
  private connections: Map<string, DataConnection> = new Map();
  private onGameStateChange: ((state: any) => void) | null = null;
  private validationToken: string | null = null;

  async initialize(validationToken?: string): Promise<string> {
    this.validationToken = validationToken || null;
    
    this.peer = new Peer({
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:global.stun.twilio.com:3478?transport=udp' }
        ]
      }
    });
    
    return new Promise((resolve, reject) => {
      if (!this.peer) return reject(new Error('Peer not initialized'));
      
      this.peer.on('open', (id) => {
        console.log('📡 [PeerJS] My Peer ID:', id);
        resolve(id);
      });

      this.peer.on('connection', (conn) => {
        console.log('📡 [PeerJS] Incoming connection from:', conn.peer);
        this.connections.set(conn.peer, conn);
        this.setupConnectionHandlers(conn);
      });

      this.peer.on('error', (err) => {
        console.error('❌ [PeerJS] Peer error:', err);
        reject(err);
      });
    });
  }

  async connectToPeer(peerId: string) {
    if (!this.peer) throw new Error('Peer not initialized');
    
    console.log('📡 [PeerJS] Connecting to peer:', peerId);
    const conn = this.peer.connect(peerId);
    this.connections.set(peerId, conn);
    this.setupConnectionHandlers(conn);
    
    return new Promise((resolve, reject) => {
      conn.on('open', () => {
        console.log('📡 [PeerJS] Connection open to:', peerId);
        // Send validation token to other peer for verification
        if (this.validationToken) {
          conn.send({ type: 'VALIDATION_TOKEN', token: this.validationToken });
        }
        resolve(conn);
      });
      conn.on('error', reject);
    });
  }

  private setupConnectionHandlers(conn: DataConnection) {
    conn.on('data', (data: any) => {
      if (data.type === 'GAME_STATE_UPDATE') {
        // Verify game state integrity before processing
        if (this.validateGameState(data.state)) {
          this.onGameStateChange?.(data.state);
        }
      } else if (data.type === 'VALIDATION_TOKEN') {
        console.log(`📡 [PeerJS] Received validation token from ${conn.peer}: ${data.token}`);
        // In a real implementation, we would verify this token with the server
      } else {
        this.onGameStateChange?.(data);
      }
    });

    conn.on('close', () => {
      console.log('📡 [PeerJS] Connection closed by:', conn.peer);
      this.connections.delete(conn.peer);
    });
  }

  private validateGameState(state: any): boolean {
    // Basic validation to ensure state hasn't been tampered with
    if (typeof state !== 'object' || !state) return false;
    
    // Check for impossible game states (example: dice value out of bounds)
    if (state.diceValue !== undefined && (state.diceValue < 1 || state.diceValue > 6)) {
      console.warn('⚠️ [PeerJS] Invalid dice value detected in state update');
      return false;
    }
    
    return true;
  }

  sendGameState(state: any) {
    if (!this.peer) throw new Error('Peer not initialized');
    
    const validatedState = {
      ...state,
      timestamp: Date.now(),
      validationToken: this.validationToken
    };
    
    this.connections.forEach(conn => {
      if (conn.open) {
        conn.send({ type: 'GAME_STATE_UPDATE', state: validatedState });
      }
    });
  }

  onStateChange(callback: (state: any) => void) {
    this.onGameStateChange = callback;
  }

  disconnect() {
    this.connections.forEach(conn => conn.close());
    this.connections.clear();
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
    console.log('📡 [PeerJS] Gameplay disconnected');
  }
}
