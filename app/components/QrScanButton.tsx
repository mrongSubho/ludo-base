"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";

/**
 * Camera / file QR scan for WalletConnect `wc:` URIs (W5).
 * Uses html5-qrcode; degrades to file picker if camera is blocked.
 */
export default function QrScanButton({
    onScan,
}: {
    onScan: (uri: string) => void;
}) {
    const [scanning, setScanning] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const ref = useRef<Html5Qrcode | null>(null);
    const divId = "ludo-wc-qr-scan";

    const stop = useCallback(() => {
        ref.current
            ?.stop()
            .then(() => ref.current?.clear())
            .catch(() => undefined);
        ref.current = null;
        setScanning(false);
    }, []);

    useEffect(() => () => stop(), [stop]);

    const startCamera = useCallback(async () => {
        setErr(null);
        setScanning(true);
        try {
            const scanner = new Html5Qrcode(divId);
            ref.current = scanner;
            await scanner.start(
                { facingMode: "environment" },
                { fps: 8, qrbox: { width: 220, height: 220 } },
                (text) => {
                    if (text.startsWith("wc:")) {
                        onScan(text);
                        stop();
                    }
                },
                () => undefined,
            );
        } catch (e) {
            setErr(
                e instanceof Error
                    ? `${e.message} — allow camera or use file picker`
                    : "Camera unavailable",
            );
            setScanning(false);
        }
    }, [onScan, stop]);

    const onFile = useCallback(
        async (file: File) => {
            setErr(null);
            try {
                const scanner = new Html5Qrcode(divId);
                const text = await scanner.scanFile(file, false);
                if (text?.startsWith("wc:")) onScan(text);
                else setErr("No wc: URI found in image");
            } catch {
                setErr("Could not read QR from file");
            }
        },
        [onScan],
    );

    return (
        <div className="space-y-2">
            <div className="flex gap-2">
                {!scanning ? (
                    <button
                        type="button"
                        className="rounded-lg border border-white/15 px-3 py-2 text-[11px] uppercase font-bold"
                        onClick={startCamera}
                    >
                        Scan QR
                    </button>
                ) : (
                    <button
                        type="button"
                        className="rounded-lg border border-amber-400/40 px-3 py-2 text-[11px] uppercase font-bold text-amber-200"
                        onClick={stop}
                    >
                        Stop camera
                    </button>
                )}
                <label className="rounded-lg border border-white/15 px-3 py-2 text-[11px] uppercase font-bold cursor-pointer">
                    From image
                    <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void onFile(f);
                        }}
                    />
                </label>
            </div>
            <div
                id={divId}
                style={{ width: "100%", minHeight: scanning ? 220 : 0, overflow: "hidden", borderRadius: 12 }}
            />
            {err && <p className="text-[11px] text-amber-200/80">{err}</p>}
        </div>
    );
}
