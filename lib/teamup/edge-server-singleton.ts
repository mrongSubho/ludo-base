// lib/teamup/edge-server-singleton.ts
import { EdgeServerClient } from './edge-server-client';

const EDGE_URL = process.env.NEXT_PUBLIC_EDGE_SERVER_URL || 'wss://ludo-edge-server.onrender.com';

let instance: EdgeServerClient | null = null;

export const getEdgeClient = () => {
    if (!instance) {
        instance = new EdgeServerClient(EDGE_URL);
    }
    return instance;
};
