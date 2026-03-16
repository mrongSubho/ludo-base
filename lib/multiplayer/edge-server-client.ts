// lib/multiplayer/edge-server-client.ts
import { MatchRequest, MatchResponse, ValidationResult } from '../types/multiplayer.types';

export class EdgeServerClient {
  private socket: WebSocket | null = null;
  private edgeServerUrl: string;
  private messageHandlers: Map<string, (data: any) => void> = new Map();

  constructor(edgeServerUrl: string) {
    this.edgeServerUrl = edgeServerUrl;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = new WebSocket(this.edgeServerUrl);

      this.socket.onopen = () => {
        console.log('📡 [EdgeServer] Connected to matchmaking server');
        resolve();
      };

      this.socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const handler = this.messageHandlers.get(data.type);
          if (handler) {
            handler(data);
          }
        } catch (e) {
          console.error('❌ [EdgeServer] Failed to parse message:', e);
        }
      };

      this.socket.onerror = (err) => {
        console.error('❌ [EdgeServer] WebSocket error:', err);
        reject(err);
      };

      this.socket.onclose = () => {
        console.log('📡 [EdgeServer] Connection closed');
      };
    });
  }

  async findMatch(request: MatchRequest): Promise<MatchResponse> {
    return new Promise((resolve, reject) => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        return reject(new Error('Matchmaking server not connected'));
      }

      const requestId = Math.random().toString(36).substring(7);

      const handler = (data: any) => {
        if (data.requestId === requestId) {
          this.messageHandlers.delete('match_found');
          this.messageHandlers.delete('match_error');
          if (data.type === 'match_found') {
            resolve(data.data);
          } else {
            reject(new Error(data.message || 'Matchmaking error'));
          }
        }
      };

      this.messageHandlers.set('match_found', handler);
      this.messageHandlers.set('match_error', handler);

      this.socket.send(JSON.stringify({
        type: 'find_match',
        requestId,
        ...request
      }));
    });
  }

  async validateGameResult(result: any): Promise<ValidationResult> {
    return new Promise((resolve, reject) => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        return reject(new Error('Matchmaking server not connected'));
      }

      const requestId = Math.random().toString(36).substring(7);

      const handler = (data: any) => {
        if (data.requestId === requestId) {
          this.messageHandlers.delete('validation_result');
          resolve(data.data);
        }
      };

      this.messageHandlers.set('validation_result', handler);

      this.socket.send(JSON.stringify({
        type: 'validate_result',
        requestId,
        result
      }));
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }
}
