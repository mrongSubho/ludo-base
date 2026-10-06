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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
            FOUNDRY_ACCOUNT: 'definitely-not-a-keystore',
            // Stop before forge is reached; we only assert the guard fires.
        });
        assert.match(r.out, /REFUSING/, `${role}=dev-key must be refused`);
    }
});

test('sepolia (full stack) refuses to deploy MockChips to a live network', () => {
    const r = bash('scripts/foundry-deploy.sh sepolia', { USE_MOCK: 'true' });
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
    // The account name is bogus on purpose: this only asserts on the pre-forge
    // output, so the test never needs a keystore or spends ETH.
    const r = bash('scripts/foundry-deploy.sh sepolia-pool', {
        FOUNDRY_ACCOUNT: 'definitely-not-a-keystore',
        LUDO_CONFIRM_DEPLOY: '',
    });
    assert.match(r.out, /MODE\s+:\s+SIMULATION/);
    assert.doesNotMatch(r.out, /ONCHAIN EXECUTION COMPLETE/, 'a dry run must not broadcast');

    // With the opt-in set it must announce BROADCAST instead.
    const r2 = bash('scripts/foundry-deploy.sh sepolia-pool', {
        FOUNDRY_ACCOUNT: 'definitely-not-a-keystore',
        LUDO_CONFIRM_DEPLOY: 'yes',
    });
    assert.match(r2.out, /MODE\s+:\s+BROADCAST/);
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
    const env = read('contracts/.env');
    const m = env.match(/^EDGE_SIGNER=(0x[0-9a-fA-F]{40})$/m);
    assert.ok(m, 'contracts/.env must declare EDGE_SIGNER');
    assert.notEqual(m[1]!.toLowerCase(), DEV0.toLowerCase());
    assert.notEqual(m[1]!.toLowerCase(), DEV1.toLowerCase());

    const r = bash(
        `source scripts/lib-dev-keys.sh; assert_not_dev_key_on_live_network ${m[1]} "Base Sepolia"`,
    );
    assert.equal(r.code, 0, 'declared EDGE_SIGNER must pass the dev-key guard');
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
