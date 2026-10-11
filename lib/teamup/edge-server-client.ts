/* eslint-disable @typescript-eslint/no-explicit-any -- legacy wire/UI types; typed burn-down tracked in docs/ops/DEPLOY_OPS.md */
// lib/teamup/edge-server-client.ts
import { MatchRequest, MatchResponse, ValidationResult } from '../types/teamup.types';

export interface EdgeServerClientOptions {
    /** Bound for connect() and for CONNECTING waits (default 10s). */
    connectTimeoutMs?: number;
    /** Poll interval while waiting for OPEN (default 100ms). */
    pollIntervalMs?: number;
}

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_POLL_INTERVAL_MS = 100;

export class EdgeServerClient {
  private socket: WebSocket | null = null;
  private edgeServerUrl: string;
  private messageHandlers: Map<string, Set<(data: any) => void>> = new Map();
  private readonly connectTimeoutMs: number;
  private readonly pollIntervalMs: number;

  constructor(edgeServerUrl: string, opts: EdgeServerClientOptions = {}) {
    this.edgeServerUrl = edgeServerUrl;
    this.connectTimeoutMs = Math.max(1, opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS);
    this.pollIntervalMs = Math.max(1, opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
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

  /** Test/observability hook: handlers currently registered for a type. */
  listenerCount(type: string): number {
    return this.messageHandlers.get(type)?.size ?? 0;
  }

  /** Resolve once the socket is OPEN, or reject after the connect timeout. */
  private waitForOpen(): Promise<void> {
    return new Promise((resolve, reject) => {
        const socket = this.socket;
        if (!socket) return reject(new Error('Socket cleared'));
        if (socket.readyState === WebSocket.OPEN) return resolve(undefined);
        if (socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
            return reject(new Error('Socket closed'));
        }
        // NET-25: the old loop polled every 100ms FOREVER while CONNECTING.
        const deadline = Date.now() + this.connectTimeoutMs;
        const timer = setInterval(() => {
            if (!this.socket || this.socket !== socket) {
                clearInterval(timer);
                reject(new Error('Socket cleared'));
                return;
            }
            if (socket.readyState === WebSocket.OPEN) {
                clearInterval(timer);
                resolve(undefined);
            } else if (socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
                clearInterval(timer);
                reject(new Error('Socket closed'));
            } else if (Date.now() >= deadline) {
                clearInterval(timer);
                reject(new Error(`Edge connect timed out after ${this.connectTimeoutMs}ms`));
            }
        }, this.pollIntervalMs);
    });
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      // If already open, resolve immediately
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        return resolve();
      }

      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      // NET-25: connect() used to hang forever when the server never
      // answers (no timeout, and onclose-before-open never settled).
      const timer = setTimeout(() => {
        const sock = this.socket;
        if (sock) {
            // Our own abort must not masquerade as the error below.
            sock.onclose = null;
            this.socket = null;
            try {
                sock.close();
            } catch {
                /* ignore close errors on timeout */
            }
        }
        finish(() => reject(new Error(`Edge connect timed out after ${this.connectTimeoutMs}ms`)));
      }, this.connectTimeoutMs);

      this.socket = new WebSocket(this.edgeServerUrl);

      this.socket.onopen = () => {
        console.log('📡 [EdgeServer] Connected');
        finish(() => resolve());
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
        finish(() => reject(new Error(errorMessage)));
      };

      this.socket.onclose = () => {
        console.log('📡 [EdgeServer] Connection closed');
        finish(() => reject(new Error('Edge socket closed before open')));
      };
    });
  }

  async findMatch(request: MatchRequest): Promise<MatchResponse> {
    // ... wait for connection logic omitted for brevity in replace, but must be preserved ...
    await this.waitForOpen();

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
    await this.waitForOpen();

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
      try {
        this.socket.close();
      } catch {
        /* ignore close errors on teardown */
      }
      this.socket = null;
    }
    // NET-25: handlers survived disconnect, so a reconnected client kept
    // firing stale closures (and leaked them). Teardown clears everything.
    this.messageHandlers.clear();
  }
}
