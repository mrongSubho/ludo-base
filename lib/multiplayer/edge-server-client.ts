// lib/multiplayer/edge-server-client.ts
import { MatchRequest, MatchResponse, ValidationResult } from '../types/multiplayer.types';

export class EdgeServerClient {
  private pc: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private edgeServerUrl: string;

  constructor(edgeServerUrl: string) {
    this.edgeServerUrl = edgeServerUrl;
  }

  async connect(): Promise<void> {
    this.pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    this.dataChannel = this.pc.createDataChannel('matchmaking', {
      ordered: true,
      maxRetransmits: 3
    });

    return new Promise((resolve, reject) => {
      if (!this.pc) return reject(new Error('PC not initialized'));

      this.pc.createOffer()
        .then(async (offer) => {
          await this.pc?.setLocalDescription(offer);
          
          // Send offer to edge server through HTTPS signaling
          const response = await fetch(`${this.edgeServerUrl}/api/signaling`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'offer', offer })
          });

          if (!response.ok) {
            throw new Error(`Signaling failed: ${response.statusText}`);
          }

          const { answer } = await response.json();
          await this.pc?.setRemoteDescription(new RTCSessionDescription(answer));
          
          this.dataChannel!.onopen = () => {
            console.log('📡 [EdgeServer] Matchmaking channel open');
            resolve();
          };

          this.dataChannel!.onerror = (err) => {
            console.error('❌ [EdgeServer] Data channel error:', err);
            reject(err);
          };
        })
        .catch(reject);
    });
  }

  async findMatch(request: MatchRequest): Promise<MatchResponse> {
    return new Promise((resolve, reject) => {
      if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
        return reject(new Error('Data channel not ready'));
      }

      const message = JSON.stringify({
        type: 'find_match',
        ...request
      });

      this.dataChannel.onmessage = (event) => {
        const response = JSON.parse(event.data);
        if (response.type === 'match_found') {
          resolve(response.data);
        } else if (response.type === 'error') {
          reject(new Error(response.message));
        }
      };

      this.dataChannel.send(message);
    });
  }

  async validateGameResult(result: any): Promise<ValidationResult> {
    return new Promise((resolve, reject) => {
      if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
        return reject(new Error('Data channel not ready'));
      }

      const message = JSON.stringify({
        type: 'validate_result',
        result
      });

      this.dataChannel.onmessage = (event) => {
        const response = JSON.parse(event.data);
        if (response.type === 'validation_result') {
          resolve(response.data);
        } else if (response.type === 'error') {
          reject(new Error(response.message));
        }
      };

      this.dataChannel.send(message);
    });
  }

  disconnect(): void {
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    console.log('📡 [EdgeServer] Disconnected');
  }
}
