/**
 * E3 — replay CLI. Load a JSONL replay, print summary, verify end hash.
 *
 * Usage:
 *   npx tsx scripts/replay.ts inspect path/to/replay.jsonl
 *   npx tsx scripts/replay.ts verify path/to/replay.jsonl
 *   npx tsx scripts/replay.ts export path/to/replay.jsonl
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { parseReplay, serializeReplay, replayFingerprint } from '../lib/replay/log';
import { hashString } from '../lib/replay/hash';

function usage(): never {
    console.error(`Usage:
  npx tsx scripts/replay.ts inspect <file.jsonl>
  npx tsx scripts/replay.ts verify  <file.jsonl>
  npx tsx scripts/replay.ts export  <file.jsonl> [out.jsonl]`);
    process.exit(2);
}

function main() {
    const [cmd, file, out] = process.argv.slice(2);
    if (!cmd || !file) usage();

    const text = readFileSync(file, 'utf8');
    const log = parseReplay(text);

    if (cmd === 'inspect') {
        const kinds = new Map<string, number>();
        for (const ev of log.events) kinds.set(ev.kind, (kinds.get(ev.kind) ?? 0) + 1);
        console.log('replay', {
            matchId: log.matchId,
            playerCount: log.playerCount,
            startedAt: log.startedAt,
            events: log.events.length,
            finalHash: log.finalHash ?? null,
            fingerprint: hashString(replayFingerprint(log)).slice(0, 12),
            kinds: Object.fromEntries(kinds),
        });
        return;
    }

    if (cmd === 'verify') {
        const lastHash = log.finalHash ?? log.events.filter((e) => e.hash).at(-1)?.hash;
        const lastEventHash = log.events.filter((e) => e.hash).at(-1)?.hash;
        const ok = !log.finalHash || !lastEventHash || log.finalHash === lastEventHash;
        // Verify JSONL integrity + monotonic seq within the log
        let prevSeq = -1;
        let seqOk = true;
        for (const ev of log.events) {
            if (ev.seq < prevSeq) seqOk = false;
            prevSeq = ev.seq;
        }
        console.log({
            ok: ok && seqOk,
            finalHash: lastHash ?? null,
            seqMonotonic: seqOk,
            events: log.events.length,
        });
        process.exit(ok && seqOk ? 0 : 1);
    }

    if (cmd === 'export') {
        const textOut = serializeReplay(log);
        if (out) {
            writeFileSync(out, textOut);
            console.log('wrote', out);
        } else {
            process.stdout.write(textOut);
        }
        return;
    }

    usage();
}

main();
