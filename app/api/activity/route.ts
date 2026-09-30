import { NextRequest, NextResponse } from "next/server";

/**
 * Wallet activity from Etherscan V2 (Base Sepolia = chainid 84532).
 * Keeps the API key server-side. Requires ETHERSCAN_API_KEY in env.
 */

const CHAIN_ID = "84532";
const API = "https://api.etherscan.io/v2/api";

type ScanTx = {
    hash: string;
    from: string;
    to: string;
    value: string;
    timeStamp: string;
    isError: string;
    functionName?: string;
};

type ScanTokenTx = {
    hash: string;
    from: string;
    to: string;
    value: string;
    timeStamp: string;
    tokenDecimal: string;
    tokenSymbol: string;
};

async function scan(params: Record<string, string>) {
    const key = process.env.ETHERSCAN_API_KEY;
    if (!key) return { ok: false as const, error: "ETHERSCAN_API_KEY not set" };
    const qs = new URLSearchParams({
        chainid: CHAIN_ID,
        apikey: key,
        ...params,
    });
    const res = await fetch(`${API}?${qs}`, { next: { revalidate: 30 } });
    const data = await res.json().catch(() => ({}));
    if (data?.status === "1" || data?.result) {
        return { ok: true as const, result: (data.result ?? []) as unknown[] };
    }
    return {
        ok: false as const,
        error: typeof data?.result === "string" ? data.result : "explorer error",
    };
}

export async function GET(req: NextRequest) {
    const wallet = (req.nextUrl.searchParams.get("wallet") || "").toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(wallet)) {
        return NextResponse.json({ error: "wallet required" }, { status: 400 });
    }

    const [txs, tokens] = await Promise.all([
        scan({
            module: "account",
            action: "txlist",
            address: wallet,
            sort: "desc",
            page: "1",
            offset: "50",
        }),
        scan({
            module: "account",
            action: "tokentx",
            address: wallet,
            sort: "desc",
            page: "1",
            offset: "50",
        }),
    ]);

    const native = txs.ok
        ? (txs.result as ScanTx[])
              .filter((t) => t.hash && (t.from || t.to))
              .map((t) => ({
                  id: t.hash,
                  kind: t.from?.toLowerCase() === wallet ? "send" : "receive",
                  status: t.isError === "1" ? ("failed" as const) : ("confirmed" as const),
                  token: "ETH" as const,
                  amount: (Number(t.value || "0") / 1e18).toString(),
                  counterparty:
                      t.from?.toLowerCase() === wallet ? t.to || "—" : t.from || "—",
                  hash: t.hash,
                  at: Number(t.timeStamp || "0") * 1000,
              }))
        : [];

    const erc20 = tokens.ok
        ? (tokens.result as ScanTokenTx[])
              .filter((t) => t.hash)
              .map((t) => {
                  const isIn = t.to?.toLowerCase() === wallet;
                  const dec = Number(t.tokenDecimal || "18");
                  const raw = Number(t.value || "0");
                  const amt = dec ? raw / 10 ** dec : raw;
                  const symbol = (t.tokenSymbol || "TOKEN").toUpperCase();
                  return {
                      id: `${t.hash}-tok`,
                      kind: isIn ? ("receive" as const) : ("send" as const),
                      status: "confirmed" as const,
                      token: (symbol === "USDC" || symbol === "CHIPS"
                          ? symbol
                          : symbol === "ETH"
                            ? "ETH"
                            : "CHIPS") as "ETH" | "USDC" | "CHIPS",
                      amount: String(amt),
                      counterparty: isIn ? t.from || "—" : t.to || "—",
                      hash: t.hash,
                      at: Number(t.timeStamp || "0") * 1000,
                  };
              })
        : [];

    return NextResponse.json({
        ok: Boolean(txs.ok || tokens.ok),
        error: txs.ok || tokens.ok ? undefined : txs.error,
        items: [...native, ...erc20],
    });
}
