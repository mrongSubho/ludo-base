import { NextResponse } from 'next/server';
import { fetchArenaDirectory } from '@/lib/arena/directoryService';

/**
 * GET /api/live-arena/directory
 * Public read aggregator uniting active matchmaking queues, open room broadcasts,
 * and live streamable matches with hydrated player avatars and clan tags.
 * Never returns validation_token or join_secret_hash.
 */
export async function GET() {
    try {
        const data = await fetchArenaDirectory();
        return NextResponse.json(data, {
            headers: { 'Cache-Control': 'no-store' },
        });
    } catch (error) {
        console.error('[live-arena:directory]', error);
        return NextResponse.json(
            { error: (error as Error).message || 'Failed to load arena directory' },
            { status: 500 },
        );
    }
}
