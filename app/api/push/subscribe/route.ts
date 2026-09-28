import { NextRequest, NextResponse } from "next/server";
import { requireAppSession } from "@/lib/serverAuth";
import { dropPushSubscription, savePushSubscription } from "@/lib/pushServer";

/**
 * POST { walletAddress, sessionId, subscription: PushSubscriptionJSON, action?: "subscribe"|"unsubscribe" }
 * App-session gated — never stores a subscription for an unauthenticated wallet.
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json().catch(() => ({}));
        const wallet = String(body.walletAddress || "").toLowerCase();
        const requester = await requireAppSession(wallet, body.sessionId);
        if (!requester) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

        const action = body.action === "unsubscribe" ? "unsubscribe" : "subscribe";
        const endpoint = String(body.subscription?.endpoint || body.endpoint || "");

        if (action === "unsubscribe") {
            if (!endpoint) return NextResponse.json({ error: "endpoint required" }, { status: 400 });
            await dropPushSubscription(endpoint);
            return NextResponse.json({ ok: true, action });
        }

        const result = await savePushSubscription(wallet, body.subscription, req.headers.get("user-agent") || undefined);
        if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
        return NextResponse.json({ ok: true, action });
    } catch (error) {
        return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
}
