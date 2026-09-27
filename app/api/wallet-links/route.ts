import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { verifyPersonalSign } from "@/lib/walletVerify";
import { buildWalletLinkMessage } from "@/lib/walletLink";

function serviceClient() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return null;
    return createClient(url, key, { auth: { persistSession: false } });
}

/** GET ?wallet=0x… → links where wallet is primary or linked */
export async function GET(req: NextRequest) {
    const wallet = (req.nextUrl.searchParams.get("wallet") || "").toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(wallet)) {
        return NextResponse.json({ error: "wallet required" }, { status: 400 });
    }
    const db = serviceClient();
    if (!db) return NextResponse.json({ error: "server not configured" }, { status: 500 });

    const { data, error } = await db
        .from("wallet_links")
        .select("primary_wallet, linked_wallet, link_type, created_at")
        .or(`primary_wallet.eq.${wallet},linked_wallet.eq.${wallet}`);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ links: data ?? [] });
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
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({
        ok: true,
        link: { ...row, created_at: new Date().toISOString() },
        progressionMerged: false,
    });
}
