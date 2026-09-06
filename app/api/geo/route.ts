import { NextResponse } from 'next/server';

// GET /api/geo — viewer country from the edge (Vercel IP geolocation).
// Powers the Live Broadcast Local filter. 'XX' = unknown (local dev included).
export async function GET(request: Request) {
    const country = (request.headers.get('x-vercel-ip-country') || 'XX').toUpperCase().slice(0, 2);
    return NextResponse.json({ country });
}
