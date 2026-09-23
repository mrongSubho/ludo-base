/**
 * Perf / report / Sentry unit tests (un-park items 1 & 3).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDevicePassReport, formatDevicePassMarkdown } from '../lib/perf/report';
import { parseSentryDsn, sentryStoreUrl, createSentryTransport } from '../lib/telemetrySentry';
import { setTelemetryTransport, track, captureException, initTelemetry } from '../lib/telemetry';
import type { HopMetrics } from '../lib/perf/budget';

function hop(ms: number, ok = true): HopMetrics {
    return {
        label: 'test',
        durationMs: ms,
        composeMs: ms,
        longTasks: 0,
        ok,
        violations: ok ? [] : [`compose ${ms}ms`],
    };
}

test('Q2 device pass report verdicts', () => {
    const empty = buildDevicePassReport([], { userAgent: 'test', viewport: { w: 1, h: 1, dpr: 1 } });
    assert.equal(empty.verdict, 'incomplete');

    const good = buildDevicePassReport([hop(4), hop(8), hop(12), hop(15)], {
        userAgent: 'test',
        viewport: { w: 100, h: 200, dpr: 2 },
    });
    assert.equal(good.verdict, 'pass');
    assert.ok(good.summary.p95 <= 16);

    const bad = buildDevicePassReport([hop(40), hop(50), hop(60)], {
        userAgent: 'test',
        viewport: { w: 1, h: 1, dpr: 1 },
    });
    assert.equal(bad.verdict, 'fail');
    assert.ok(bad.failures.length >= 1);

    const md = formatDevicePassMarkdown(good);
    assert.match(md, /Verdict/);
    assert.match(md, /PASS/);
});

test('Sentry DSN parse + store URL', () => {
    const parts = parseSentryDsn('https://abc123key@o123.ingest.sentry.io/456');
    assert.ok(parts);
    assert.equal(parts!.publicKey, 'abc123key');
    assert.equal(parts!.projectId, '456');
    assert.equal(sentryStoreUrl(parts!), 'https://o123.ingest.sentry.io/api/456/store/');

    const nested = parseSentryDsn('https://k@localhost:9000/1');
    assert.ok(nested);
    assert.ok(sentryStoreUrl(nested!).startsWith('http://localhost:9000/'));

    assert.equal(parseSentryDsn('not-a-url'), null);
    assert.equal(parseSentryDsn('https://no-project@host/'), null);
});

test('Sentry transport binds without breaking track (fetch stubbed)', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(url), body: String(init?.body ?? '') });
        return new Response('{}', { status: 200 });
    }) as typeof fetch;

    try {
        const transport = createSentryTransport({
            dsn: 'https://pub@sentry.example/42',
            environment: 'test',
        });
        setTelemetryTransport(transport);
        track('roll_ok', { dice: 6, signature: 'should-not-matter' });
        captureException(new Error('boom'), { where: 'unit' });
        await new Promise((r) => setTimeout(r, 10));
        assert.equal(calls.length, 2);
        assert.match(calls[0].url, /\/api\/42\/store\/$/);
        assert.match(calls[0].body, /roll_ok/);
        assert.match(calls[1].body, /boom/);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test('initTelemetry remains idempotent after Sentry bind', () => {
    let n = 0;
    setTelemetryTransport({
        track(name) {
            if (name === 'session_start') n += 1;
        },
        exception() {},
    });
    initTelemetry({ dsn: 'https://pub@host/1' });
    initTelemetry();
    assert.equal(n, 1);
});
