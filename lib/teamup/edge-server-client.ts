// lib/teamup/edge-server-client.ts
import { MatchRequest, MatchResponse, ValidationResult } from '../types/teamup.types';

export class EdgeServerClient {
  private socket: WebSocket | null = null;
  private edgeServerUrl: string;
  private messageHandlers: Map<string, (data: any) => void> = new Map();

  constructor(edgeServerUrl: string) {
    this.edgeServerUrl = edgeServerUrl;
  }

  getEdgeUrl(): string {
    return this.edgeServerUrl;
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

      this.socket.onerror = (err: any) => {
        const errorMessage = `WebSocket error for ${this.edgeServerUrl}`;
        console.error(`❌ [EdgeServer] ${errorMessage}:`, err);
        reject(new Error(errorMessage));
      };

      this.socket.onclose = () => {
        console.log('📡 [EdgeServer] Connection closed');
      };
    });
  }

  async findMatch(request: MatchRequest): Promise<MatchResponse> {
    // Wait for connection if it's still connecting (happens on Render free tier cold starts)
    if (this.socket && this.socket.readyState === WebSocket.CONNECTING) {
      console.log('⏳ [EdgeServer] Connection in progress, waiting...');
      await new Promise<void>((resolve, reject) => {
        const check = () => {
          if (!this.socket) return reject(new Error('Socket cleared during connection'));
          if (this.socket.readyState === WebSocket.OPEN) resolve();
          else if (this.socket.readyState === WebSocket.CLOSED || this.socket.readyState === WebSocket.CLOSING)
            reject(new Error('Socket closed while waiting for connection'));
          else setTimeout(check, 100);
        };
        check();
      });
    }

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
    // Wait for connection if it's still connecting
    if (this.socket && this.socket.readyState === WebSocket.CONNECTING) {
      await new Promise<void>((resolve, reject) => {
        const check = () => {
          if (!this.socket) return reject(new Error('Socket cleared during connection'));
          if (this.socket.readyState === WebSocket.OPEN) resolve();
          else if (this.socket.readyState === WebSocket.CLOSING || this.socket.readyState === WebSocket.CLOSING) 
            reject(new Error('Socket closed'));
          else setTimeout(check, 100);
        };
        check();
      });
    }

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
