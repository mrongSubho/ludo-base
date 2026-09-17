import { NextResponse } from 'next/server';
import { serviceDb } from '@/lib/serverAuth';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const target = searchParams.get('target')?.toLowerCase();
        const db = serviceDb();
        let query = db.from('activities')
            .select('id, actor_id, type, metadata, created_at')
            .order('created_at', { ascending: false }).limit(10);
        if (target && /^0x[a-f0-9]{40}$/.test(target)) query = query.eq('type', 'congratulate').filter('metadata->>target_id', 'eq', target);
        const { data, error } = await query;
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        const actors = [...new Set((data || []).map((row) => row.actor_id).filter(Boolean))];
        const { data: players } = actors.length
            ? await db.from('players').select('wallet_address, username, avatar_url').in('wallet_address', actors)
            : { data: [] };
        const profiles = new Map((players || []).map((p) => [String(p.wallet_address).toLowerCase(), p]));
        return NextResponse.json((data || []).map((row) => ({
            ...row, actor: profiles.get(String(row.actor_id).toLowerCase()) || null,
        })));
    } catch (error) {
        return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
}
