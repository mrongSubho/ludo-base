/**
 * Deploy-time guard rails.
 *
 * These are shell scripts, so the only way to keep them honest is to execute
 * them and assert on the behaviour. A dev-key guard that is never run is a
 * comment; a deploy helper that broadcasts on invocation is a loaded gun that
 * gets fired by a stray test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = join(import.meta.dirname ?? __dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

/** Run a bash snippet with the repo scripts/ on PATH. Returns {out, code}. */
function bash(snippet: string, env: Record<string, string> = {}): { out: string; code: number } {
    try {
        const out = execFileSync('bash', ['-c', snippet], {
            cwd: root,
            encoding: 'utf8',
            env: { ...process.env, PATH: `${process.env.PATH}:${process.env.HOME}/.foundry/bin`, ...env },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        return { out, code: 0 };
    } catch (e) {
        const err = e as { stdout?: string; stderr?: string; status?: number };
        return { out: `${err.stdout ?? ''}${err.stderr ?? ''}`, code: err.status ?? 1 };
    }
}

/**
 * Where tests let the deploy scripts read their env file.
 *
 * `scripts/lib-load-env.sh` *creates* `$LUDO_ENV_FILE` from `.env.example` when
 * it is missing (a first-run bootstrap, so the required keys are visible). That
 * is fine interactively and wrong in a test: running the suite used to leave a
 * placeholder `contracts/.env` in the developer's tree, and on CI — which has no
 * such file — it left one behind for the rest of the run, which then failed the
 * edge-signer check below for "declares no EDGE_SIGNER".
 *
 * Pointing LUDO_ENV_FILE at a throwaway path keeps the bootstrap (and its echo)
 * inside tmp/ and leaves the real file alone.
 */
const SANDBOX_ENV = join(tmpdir(), 'ludo-deploy-guardrails', 'contracts', '.env');

/**
 * Materialise the sandbox env file from `contracts/.env.example`.
 *
 * It has to actually contain the example's keys, not just exist: with an empty
 * file the loader exports nothing, `require_env` bails at "MISSING
 * CHIPS_ADDRESS", and the tests never reach the guard or the mode banner they
 * are asserting on. Copying the example reproduces exactly what the loader sees
 * on a machine that has run setup once, which is what these tests mean to test.
 */
function sandboxEnv(): string {
    mkdirSync(join(SANDBOX_ENV, '..'), { recursive: true });
    copyFileSync(join(root, 'contracts/.env.example'), SANDBOX_ENV);
    return SANDBOX_ENV;
}

sandboxEnv();

const DEV0 = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'; // anvil #0
const DEV1 = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8'; // anvil #1
const NEW_EDGE = '0x77BCbB1EE19b7DEc89D7e13Fe136d2774F24A0E2';
const OWNER = '0xbcCa5DcBF293D98A627fD3814D5AE8249bB1DFaF';

test('the dev-key guard refuses an anvil address on a live network', () => {
    for (const dev of [DEV0, DEV1]) {
        const r = bash(
            `source scripts/lib-dev-keys.sh; assert_not_dev_key_on_live_network ${dev} "Base Sepolia"`,
        );
        assert.equal(r.code, 1, `${dev} must be refused`);
        assert.match(r.out, /REFUSING/);
    }
});

test('the dev-key guard still refuses when foundry is not installed', () => {
    // Regression, and the reason CI was red while this suite passed locally.
    // The guard used to derive each dev address with `cast` and `continue` past
    // any failure. On a runner without foundry every derivation failed, every key
    // was skipped, and the guard returned 0 — approving an anvil key for Base
    // Sepolia. The refusal must not depend on optional tooling being present.
    const bare = '/usr/bin:/bin';
    if (execFileSync('bash', ['-c', `command -v cast || true`], {
        cwd: root, encoding: 'utf8', env: { ...process.env, PATH: bare },
    }).trim() !== '') {
        return; // cannot build a foundry-free PATH here; the assertion below is
                // the real guard anyway.
    }
    for (const dev of [DEV0, DEV1]) {
        const r = bash(
            `source scripts/lib-dev-keys.sh; assert_not_dev_key_on_live_network ${dev} "Base Sepolia"`,
            { PATH: bare },
        );
        assert.equal(r.code, 1, `${dev} must be refused even with no foundry`);
        assert.match(r.out, /REFUSING/);
    }
    // And the list must not be a placeholder that only the cast path can populate.
    const lib = read('scripts/lib-dev-keys.sh');
    assert.match(lib, /ANVIL_DEFAULT_ADDRESSES=/);
    const aStart = lib.indexOf('ANVIL_DEFAULT_ADDRESSES=(');
    const listed = lib.slice(aStart, lib.indexOf(')', aStart));
    for (const dev of [DEV0, DEV1]) {
        assert.ok(listed.toLowerCase().includes(dev.toLowerCase()), `${dev} must be listed as a known address`);
    }
    const kStart = lib.indexOf('ANVIL_DEFAULT_KEYS=(');
    const keyCount = lib.slice(kStart, lib.indexOf(')', kStart)).split('0x').length - 1;
    const addrCount = listed.split('0x').length - 1;
    assert.equal(addrCount, keyCount, 'key and address lists must stay the same length');
});

test('the dev-key guard allows a real address', () => {
    for (const addr of [NEW_EDGE, OWNER]) {
        const r = bash(
            `source scripts/lib-dev-keys.sh; assert_not_dev_key_on_live_network ${addr} "Base Sepolia"`,
        );
        assert.equal(r.code, 0, `${addr} must be allowed`);
        assert.doesNotMatch(r.out, /REFUSING/);
    }
});

test('sepolia-pool refuses to deploy with a dev key in any on-chain role', () => {
    // Each role is checked independently: the edge signer being public is fatal
    // (it authorizes settlement co-signatures), and so is the owner.
    const roles = ['EDGE_SIGNER', 'GAME_OWNER', 'DEPLOYER_ADDRESS'];
    for (const role of roles) {
        const base: Record<string, string> = {
            EDGE_SIGNER: NEW_EDGE,
            GAME_OWNER: OWNER,
            DEPLOYER_ADDRESS: OWNER,
        };
        base[role] = DEV0;
        const r = bash(`scripts/foundry-deploy.sh sepolia-pool`, {
            ...base,
            LUDO_ENV_FILE: SANDBOX_ENV,
            FOUNDRY_ACCOUNT: 'definitely-not-a-keystore',
            // Stop before forge is reached; we only assert the guard fires.
        });
        assert.match(r.out, /REFUSING/, `${role}=dev-key must be refused`);
    }
});

test('sepolia (full stack) refuses to deploy MockChips to a live network', () => {
    const r = bash('scripts/foundry-deploy.sh sepolia', {
        USE_MOCK: 'true',
        LUDO_ENV_FILE: SANDBOX_ENV,
    });
    assert.match(r.out, /refusing/, 'USE_MOCK=true must be refused on Sepolia');
});

test('-pool verbs simulate by default and only broadcast on explicit opt-in', () => {
    // The helper used to call `forge script --broadcast` unconditionally, so a
    // stray invocation (a test, a shell-history entry) spent real ETH deploying
    // whatever contracts/.env happened to hold.
    const src = read('scripts/foundry-deploy.sh');
    assert.match(src, /LUDO_CONFIRM_DEPLOY/, 'broadcast must be gated behind an opt-in');

    // Every --broadcast that can reach a live network must come from an array
    // populated only when LUDO_CONFIRM_DEPLOY=yes. Anvil keeps a literal, which
    // is fine: those verbs only ever target 127.0.0.1.
    const lines = src.split('\n');
    const anvilVerbs = ['anvil)', 'anvil-pool)'];
    let inLiveVerb = false;
    for (const line of lines) {
        const verb = line.trim();
        if (/^[a-z-]+\)$/.test(verb)) {
            inLiveVerb = !anvilVerbs.includes(verb);
            continue;
        }
        if (inLiveVerb && /--broadcast/.test(line) && !/broadcast=\(--broadcast\)/.test(line)) {
            assert.fail(`literal --broadcast in live verb near: ${line.trim()}`);
        }
    }

    // And the dry run must announce itself and never reach the broadcast stage.
    //
    // These three addresses are supplied inline because the script's
    // `require_env` runs before it prints the mode, and it loads them from
    // `contracts/.env` otherwise. That file is gitignored — so without them this
    // test exited at "MISSING EDGE_SIGNER" on CI and never reached the assertion,
    // while passing on any developer machine that had deployed at least once.
    // That is the same class of bug as the dev-key guard depending on `cast`:
    // a test whose result depended on undeclared local state.
    //
    // They are the REAL deployed addresses, not the anvil defaults, because
    // `assert_not_dev_key_on_live_network` runs immediately after `require_env`
    // and would (correctly) refuse anything on the dev list — which is itself a
    // nice thing for the test to be exercising. No keystore is needed: the
    // assertion is entirely on the pre-forge output, so nothing is signed,
    // broadcast, or spent.
    const inline = {
        EDGE_SIGNER: NEW_EDGE,
        GAME_OWNER: OWNER,
        DEPLOYER_ADDRESS: OWNER,
        FOUNDRY_ACCOUNT: 'definitely-not-a-keystore',
    };

    const r = bash('scripts/foundry-deploy.sh sepolia-pool', {
        ...inline,
        LUDO_ENV_FILE: SANDBOX_ENV,
        LUDO_CONFIRM_DEPLOY: '',
    });
    assert.match(r.out, /MODE\s+:\s+SIMULATION/, r.out);
    assert.doesNotMatch(r.out, /ONCHAIN EXECUTION COMPLETE/, 'a dry run must not broadcast');

    // With the opt-in set it must announce BROADCAST instead.
    const r2 = bash('scripts/foundry-deploy.sh sepolia-pool', {
        ...inline,
        LUDO_ENV_FILE: SANDBOX_ENV,
        LUDO_CONFIRM_DEPLOY: 'yes',
    });
    assert.match(r2.out, /MODE\s+:\s+BROADCAST/, r2.out);
});

test('the committed well-known dev key is gone from every live-network path', () => {
    const ANVIL0_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
    // foundry-deploy.sh may keep it ONLY in the anvil/anvil-pool verbs, which
    // target 127.0.0.1 and hold no value.
    const deploy = read('scripts/foundry-deploy.sh');
    const occurrences = deploy.split(ANVIL0_PK).length - 1;
    assert.ok(occurrences > 0, 'the anvil verbs legitimately need the local key');
    for (const verb of ['sepolia-pool', 'base-pool', 'sepolia']) {
        const body = deploy.slice(deploy.indexOf(`${verb})`));
        const nextVerb = deploy.indexOf('\n    ;;', deploy.indexOf(`${verb})`));
        const block = nextVerb > 0 ? body.slice(0, nextVerb - body.length) : body;
        assert.doesNotMatch(block, new RegExp(ANVIL0_PK.slice(2, 10)), `${verb} must not use a dev key`);
    }

    // smoke-sepolia.sh targets a live chain, so it must not reference one at all.
    const smoke = read('scripts/smoke-sepolia.sh');
    assert.doesNotMatch(smoke, new RegExp(ANVIL0_PK.slice(2, 10)), 'smoke-sepolia must not use anvil #0');
    assert.doesNotMatch(smoke, /59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d/);
    assert.match(smoke, /--keystore/, 'smoke roles must come from keystores');
    assert.match(smoke, /assert_not_dev_key_on_live_network/);

    // The Solidity smoke scripts also sign host/settle digests for a live chain,
    // so they must take their keys from env rather than compiling them in.
    for (const f of ['contracts/script/SmokeSepolia.s.sol', 'contracts/script/SmokeRealChips.s.sol']) {
        const src = read(f);
        assert.doesNotMatch(src, new RegExp(ANVIL0_PK.slice(2, 10)), `${f} must not embed a dev key`);
        assert.match(src, /SMOKE_HOST_PK/, `${f} must read the host key from env`);
        assert.match(src, /SMOKE_P2_PK/, `${f} must read the second key from env`);
    }
});

test('the edge signer is not a well-known dev key', () => {
    // Regression: EDGE_SIGNER was 0xf39F… (anvil #0) on the live Sepolia pool,
    // whose private key is published in the Hardhat/Anvil docs. Anyone could
    // therefore sign as edge signer and authorize bet settlement co-signatures.
    // The file holding the real signer is `contracts/.env`, which is gitignored.
    // On a machine that has deployed it exists and is checked in full below; on
    // CI it does not exist, and asserting on its contents there would be
    // asserting on nothing.
    // existsSync rather than try/catch on the read: if the file is present it
    // must be usable, and if it is absent there is nothing to assert. `\s*$`
    // so a CRLF checkout does not read as "present but malformed".
    const envPath = join(root, 'contracts/.env');
    let declared: string | null = null;
    if (existsSync(envPath)) {
        const m = readFileSync(envPath, 'utf8').match(/^EDGE_SIGNER=(0x[0-9a-fA-F]{40})\s*$/m);
        assert.ok(m, `${envPath} exists but declares no EDGE_SIGNER address`);
        declared = m[1]!;
    }

    // The file must never be committed — that is the part CI can always check,
    // whether or not the secret happens to exist on the machine running it.
    const ignored = execFileSync('git', ['check-ignore', 'contracts/.env'], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    assert.equal(ignored, 'contracts/.env', 'contracts/.env must be gitignored');
    const trackedEnv = execFileSync('git', ['ls-files', 'contracts/.env'], {
        cwd: root,
        encoding: 'utf8',
    }).trim();
    assert.equal(trackedEnv, '', 'contracts/.env must not be tracked by git');

    // What CI CAN check, and what is the actual risk in this finding: the secret
    // is never committed, and no tracked file anywhere in the repo carries an
    // anvil private key. If someone pasted the key into a config or a source
    // file, this fails — with or without `contracts/.env` present.
    const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
        .split('\n')
        .filter(Boolean);
    const devKeys = [
        '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
        '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
        '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
        '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
        '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
        '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
        '0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e',
        '0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356',
        '0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97',
        '0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6',
    ];
    // Two files must contain these keys as DATA — the deny list that recognises
    // them, and this test. Everything else may only mention a key on a line that
    // is unambiguously about the throwaway local chain.
    const holdsKeysAsData = new Set([
        'scripts/lib-dev-keys.sh',
        'scripts/deploy-guardrails.test.ts',
    ]);
    for (const file of tracked) {
        if (holdsKeysAsData.has(file)) continue;
        let body: string;
        try {
            body = readFileSync(join(root, file), 'utf8');
        } catch {
            continue; // binary, or gone since ls-files
        }
        for (const key of devKeys) {
            if (!body.includes(key)) continue;
            // `scripts/foundry-deploy.sh` embeds key #0 in its anvil verbs, and
            // DeployStack.s.sol documents the local-anvil invocation with it. That
            // is fine — but only there. Requiring every occurrence to sit on a
            // line that names the local chain is what stops this from degrading
            // into "the file is on the list, anything goes in it".
            // Group backslash-continued lines into whole commands first, so a key
            // on a wrapped `--private-key` continuation is judged by the command
            // it belongs to rather than by its own line.
            const statements: { line: number; text: string }[] = [];
            let pending: { line: number; text: string } | null = null;
            for (const [i, raw] of body.split('\n').entries()) {
                const cont = /\\\s*$/.test(raw);
                const chunk = raw.replace(/\\\s*$/, '');
                if (!pending) pending = { line: i + 1, text: chunk };
                else pending.text += ' ' + chunk;
                if (!cont) {
                    statements.push(pending);
                    pending = null;
                }
            }
            if (pending) statements.push(pending);

            for (const st of statements) {
                if (!st.text.includes(key)) continue;
                const isLocalOnly = /127\.0\.0\.1|localhost|\banvil\b/i.test(st.text);
                assert.ok(
                    isLocalOnly,
                    `${file}:${st.line} holds an anvil private key in a command that does not ` +
                        'reference the local chain — anyone can sign as it',
                );
            }
        }
    }

    if (declared !== null) {
        assert.notEqual(declared.toLowerCase(), DEV0.toLowerCase());
        assert.notEqual(declared.toLowerCase(), DEV1.toLowerCase());
        const r = bash(
            `source scripts/lib-dev-keys.sh; assert_not_dev_key_on_live_network ${declared} "Base Sepolia"`,
        );
        assert.equal(r.code, 0, 'declared EDGE_SIGNER must pass the dev-key guard');
    }
});

test('shell constructs used by the deploy helper are bash 3.2 safe', () => {
    // macOS ships bash 3.2, where "${arr[@]}" on an EMPTY array trips `set -u`
    // ("unbound variable") and "${var,,}" is a syntax error. Both appeared in
    // this helper and broke the dry run and the closing hint respectively.
    const src = read('scripts/foundry-deploy.sh');
    const devKeys = read('scripts/lib-dev-keys.sh');
    for (const [name, s] of [['foundry-deploy.sh', src], ['lib-dev-keys.sh', devKeys]] as const) {
        assert.doesNotMatch(s, /\$\{[a-zA-Z_]+,,/, `${name} must not use bash-4 case expansion`);
        // Every command-position array expansion must use the +"${a[@]}" form.
        // A `for x in "${a[@]}"` header is fine (bash 3.2 allows an empty array
        // there), so those lines are excluded.
        const unguarded = s
            .split('\n')
            .filter((l) => !/^\s*for\b/.test(l))
            .flatMap((l) => l.match(/(?<!\+)"\$\{[a-zA-Z_]+\[@\]\}"/g) ?? []);
        assert.equal(unguarded.length, 0, `${name} has unguarded empty-array expansion: ${unguarded}`);
    }

    // And the actual behaviour: a dry run must not print bash diagnostics.
    const r = bash('scripts/foundry-deploy.sh sepolia-pool', {
        LUDO_ENV_FILE: SANDBOX_ENV,
        FOUNDRY_ACCOUNT: 'definitely-not-a-keystore',
    });
    assert.doesNotMatch(r.out, /unbound variable/);
    assert.doesNotMatch(r.out, /bad substitution/);
});

test('the Etherscan V2 chainid is carried in the URL, not a dropped config key', () => {
    // Etherscan retired the V1 hosts; V2 requires `chainid` as a query param.
    // Forge 1.8.x silently DROPS a `chainid` key from [etherscan] — it never
    // appears in `forge config` and has no effect — so every verify failed with
    // "Missing chainid parameter". Forge appends its query after the configured
    // URL, so baking chainid into the url works.
    const toml = read('contracts/foundry.toml');
    // Strip comments first: the file documents the trap in prose, and a comment
    // mentioning `chainid` is not a config key.
    const code = toml
        .split('\n')
        .filter((l) => !l.trim().startsWith('#'))
        .join('\n');
    // Every `chainid` in live config must be part of the URL query, i.e. directly
    // preceded by `?`. A bare `chainid = <n>` key is what forge 1.8.x drops.
    for (const line of code.split('\n')) {
        let idx = line.indexOf('chainid');
        while (idx !== -1) {
            assert.equal(
                line[idx - 1],
                '?',
                `chainid must be a url query param, not a config key: ${line.trim()}`,
            );
            idx = line.indexOf('chainid', idx + 1);
        }
    }
    assert.match(
        toml,
        /api\.etherscan\.io\/v2\/api\?chainid=84532/,
        'Base Sepolia chainid must be in the url',
    );
    assert.match(toml, /api\.etherscan\.io\/v2\/api\?chainid=8453\b/, 'Base mainnet chainid must be in the url');
    // And the deprecated V1 hosts must not reappear.
    assert.doesNotMatch(toml, /basescan\.org\/api/);
});

test('verify-contracts.sh does not gate success on a SIGPIPE-prone pipeline', () => {
    // `forge ... | tee log | grep -q` under `set -o pipefail`: grep -q exits on
    // the first match, tee takes a SIGPIPE, and the whole pipeline goes non-zero.
    // That reported a successful verification as a failure, intermittently
    // depending on how much output tee had flushed.
    const src = read('scripts/verify-contracts.sh')
        .split('\n')
        .filter((l) => !l.trim().startsWith('#'))
        .join('\n');
    assert.doesNotMatch(src, /\|\s*tee\s+\S*\s*\|\s*grep\s+-q/, 'must not pipe through grep -q');
    assert.match(src, /mktemp/, 'must capture verifier output to a file instead');
});

test('the edge signer private key lives only in gitignored env files', () => {
    // EDGE_SETTLE_PRIVATE_KEY co-signs settlement digests. It must never be
    // committed, and the two env files holding it must stay ignored.
    let ignored = '';
    try {
        ignored = execFileSync('git', ['check-ignore', '.env.local', 'contracts/.env'], {
            cwd: root,
            encoding: 'utf8',
        });
    } catch {
        ignored = '';
    }
    assert.match(ignored, /\.env\.local/, '.env.local must stay gitignored');
    assert.match(ignored, /contracts\/\.env/, 'contracts/.env must stay gitignored');

    // No tracked file may hold the variable with a value.
    const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
        .split('\n')
        .filter((f) => f && !/\.env/.test(f));
    for (const f of tracked) {
        if (/\.(ts|tsx|mjs|js|json|md|sh|sol|sql|toml)$/.test(f)) {
            const src = read(f);
            const m = src.match(/^EDGE_SETTLE_PRIVATE_KEY=(.+)$/m);
            if (m) {
                assert.match(
                    m[1]!.trim(),
                    /^\s*$/,
                    `${f} must not contain an EDGE_SETTLE_PRIVATE_KEY value`,
                );
            }
        }
    }
});
