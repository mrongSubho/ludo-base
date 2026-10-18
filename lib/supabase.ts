import { createClient } from '@supabase/supabase-js';
import { Database } from '@/types/database.types';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-key';

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    console.warn('⚠️ Supabase environment variables are missing. Using placeholders for build.');
}

export const supabase = createClient<Database>(supabaseUrl, supabaseKey);

/**
 * P5: Set authentication token for private Realtime channels (NET-03a/b).
 */
export function setRealtimeAuth(token: string): void {
    if (supabase && (supabase as unknown as { realtime?: { setAuth?: (t: string) => void } }).realtime?.setAuth) {
        (supabase as unknown as { realtime: { setAuth: (t: string) => void } }).realtime.setAuth(token);
    }
}

/**
 * P5: Create an authorized private channel with RLS protection.
 */
export function createPrivateChannel(channelName: string) {
    return supabase.channel(channelName, {
        config: {
            private: true,
        },
    });
}

