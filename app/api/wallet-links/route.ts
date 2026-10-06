import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyPersonalSign } from "@/lib/walletVerify";
import { buildWalletLinkMessage } from "@/lib/walletLink";
import { isFreshIssuedAt } from "@/lib/matchProof";
import { requireAppSession } from "@/lib/serverAuth";

function serviceClient() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return null;
    return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * GET ?wallet=0x… — links where `wallet` is primary or linked.
 *
 * SEC-24: this was readable by anyone for any wallet, through the service role.
 * A wallet link is a statement about identity, so it now needs a session and the
 * caller must be one of the two wallets in the link.
 */
export async function GET(req: NextRequest) {
    const wallet = (req.nextUrl.searchParams.get("wallet") || "").toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(wallet)) {
        return NextResponse.json({ error: "wallet required" }, { status: 400 });
    }

    // SEC-24: a session, and it must be this wallet.
    const session = await requireAppSession(
        req.nextUrl.searchParams.get("walletAddress"),
        req.nextUrl.searchParams.get("sessionId"),
    );
    if (!session) return NextResponse.json({ error: "Session required" }, { status: 401 });
    if (session !== wallet) return NextResponse.json({ error: "Not your wallet" }, { status: 403 });

    const db = serviceClient();
    if (!db) return NextResponse.json({ error: "server not configured" }, { status: 500 });

    // Two explicit .eq() queries merged in JS, not an interpolated .or()
    // (SEC-08: `.or()` is a string format, not a query API).
    const [asPrimary, asLinked] = await Promise.all([
        db.from("wallet_links")
            .select("primary_wallet, linked_wallet, link_type, created_at")
            .eq("primary_wallet", wallet),
        db.from("wallet_links")
            .select("primary_wallet, linked_wallet, link_type, created_at")
            .eq("linked_wallet", wallet),
    ]);
    const err = asPrimary.error || asLinked.error;
    if (err) {
        console.error("[wallet-links] read failed", JSON.stringify({ code: err.code, message: err.message, hint: err.hint }));
        return NextResponse.json({ error: "Could not read links" }, { status: 500 });
    }
    const seen = new Set<string>();
    const links = [...(asPrimary.data ?? []), ...(asLinked.data ?? [])].filter((r: { primary_wallet: string; linked_wallet: string }) => {
        const k = `${r.primary_wallet}:${r.linked_wallet}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
    return NextResponse.json({ links });
}

/**
 * POST { primary, linked, issuedAt, primarySignature, linkedSignature }
 * Both wallets sign the same link message. No progression merge.
 */
export async function POST(req: NextRequest) {
    const body = await req.json().catch(() => ({}));
    const primary = String(body.primary || "").toLowerCase();
    const linked = String(body.linked || "").toLowerCase();
    const issuedAt = String(body.issuedAt || "");
    const primarySignature = String(body.primarySignature || "");
    const linkedSignature = String(body.linkedSignature || "");

    if (!/^0x[a-f0-9]{40}$/.test(primary) || !/^0x[a-f0-9]{40}$/.test(linked)) {
        return NextResponse.json({ error: "primary and linked required" }, { status: 400 });
    }
    if (primary === linked) {
        return NextResponse.json({ error: "same wallet" }, { status: 400 });
    }
    // SEC-24: the signed message must be fresh. Without this, one captured pair
    // of signatures re-links the same wallets forever.
    if (!isFreshIssuedAt(issuedAt)) {
        return NextResponse.json({ error: "Link proof expired" }, { status: 401 });
    }

    const message = buildWalletLinkMessage({ primary, linked, issuedAt });
    const [a, b] = await Promise.all([
        verifyPersonalSign({ address: primary, message, signature: primarySignature }),
        verifyPersonalSign({ address: linked, message, signature: linkedSignature }),
    ]);
    if (!a.ok || !b.ok) {
        const fail = !a.ok ? a : b;
        return NextResponse.json(
            { error: "invalid signature", code: fail.ok === false ? fail.code : "invalid" },
            { status: 401 },
        );
    }

    const db = serviceClient();
    if (!db) return NextResponse.json({ error: "server not configured" }, { status: 500 });

    const row = {
        primary_wallet: primary,
        linked_wallet: linked,
        link_type: "opt_in",
    };
    const { error } = await db.from("wallet_links").upsert(row, {
        onConflict: "primary_wallet,linked_wallet",
    });
    if (error) {
        console.error("[wallet-links] upsert failed", JSON.stringify({ code: error.code, message: error.message, hint: error.hint }));
        return NextResponse.json({ error: "Link could not be saved" }, { status: 500 });
    }

    return NextResponse.json({
        ok: true,
        link: { ...row, created_at: new Date().toISOString() },
        progressionMerged: false,
    });
}
