import { NextRequest, NextResponse } from "next/server";
import { requireAppSession } from "@/lib/serverAuth";
import { pushConfigured, sendPushToWallet } from "@/lib/pushServer";

/**
 * POST { walletAddress, sessionId }
 * Sends a local test push to the caller's own subscriptions (Security panel).
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json().catch(() => ({}));
        const wallet = String(body.walletAddress || "").toLowerCase();
        const requester = await requireAppSession(wallet, body.sessionId);
        if (!requester) return NextResponse.json({ error: "Invalid session" }, { status: 401 });
        if (!pushConfigured()) {
            return NextResponse.json(
                { error: "VAPID keys not configured on this deployment" },
                { status: 503 },
            );
        }
        const result = await sendPushToWallet(wallet, {
            title: "Ludo Base",
            body: "Push is working. You'll get turn and claim nudges here.",
            url: "/",
            tag: "push-test",
        });
        return NextResponse.json({ ok: true, ...result });
    } catch (error) {
        return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
}
