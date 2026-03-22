// lib/teamup/edge-server-client.ts
import { MatchRequest, MatchResponse, ValidationResult } from '../types/teamup.types';

export class EdgeServerClient {
  private socket: WebSocket | null = null;
  private edgeServerUrl: string;
  private messageHandlers: Map<string, Set<(data: any) => void>> = new Map();

  constructor(edgeServerUrl: string) {
    this.edgeServerUrl = edgeServerUrl;
  }

  getEdgeUrl(): string {
    return this.edgeServerUrl;
  }

  addEventListener(type: string, handler: (data: any) => void) {
    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, new Set());
    }
    this.messageHandlers.get(type)!.add(handler);
  }

  removeEventListener(type: string, handler: (data: any) => void) {
    this.messageHandlers.get(type)?.delete(handler);
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      // If already open, resolve immediately
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        return resolve();
      }

      this.socket = new WebSocket(this.edgeServerUrl);

      this.socket.onopen = () => {
        console.log('📡 [EdgeServer] Connected');
        resolve();
      };

      this.socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const handlers = this.messageHandlers.get(data.type);
          if (handlers) {
            handlers.forEach(handler => handler(data));
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
    // ... wait for connection logic omitted for brevity in replace, but must be preserved ...
    if (this.socket && this.socket.readyState === WebSocket.CONNECTING) {
      await new Promise<void>((resolve, reject) => {
        const check = () => {
          if (!this.socket) return reject(new Error('Socket cleared'));
          if (this.socket.readyState === WebSocket.OPEN) resolve();
          else if (this.socket.readyState === WebSocket.CLOSED) reject(new Error('Socket closed'));
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
          this.removeEventListener('match_found', handler);
          this.removeEventListener('match_error', handler);
          if (data.type === 'match_found') {
            resolve(data.data);
          } else {
            reject(new Error(data.message || 'Matchmaking error'));
          }
        }
      };

      this.addEventListener('match_found', handler);
      this.addEventListener('match_error', handler);

      this.socket.send(JSON.stringify({
        type: 'find_match',
        requestId,
        ...request
      }));
    });
  }

  async validateGameResult(result: any): Promise<ValidationResult> {
    if (this.socket && this.socket.readyState === WebSocket.CONNECTING) {
      await new Promise<void>((resolve, reject) => {
        const check = () => {
          if (!this.socket) return reject(new Error('Socket cleared'));
          if (this.socket.readyState === WebSocket.OPEN) resolve();
          else if (this.socket.readyState === WebSocket.CLOSED) reject(new Error('Socket closed'));
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
          this.removeEventListener('validation_result', handler);
          resolve(data.data);
        }
      };

      this.addEventListener('validation_result', handler);

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
