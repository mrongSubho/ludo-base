// Flat ESLint config — Next 16 removed `next lint`; this is the honest lint
// gate. Avoid FlatCompat + eslint-config-next (circular plugin graph on ESLint
// 9 / Next 16) — but do NOT regress to stubbing the react-hooks rules while
// avoiding it: the stub let a `useRef` inside a `useEffect` ship in 881902d
// (React #321, every match start dead) through lint, tests, and the visual
// harness. The plugin is a direct devDependency for exactly this reason.
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
    {
        ignores: [
            '.next/**',
            // REA-30 (unfiled): `.open-next/` is opennextjs-cloudflare build
            // output. It appeared in the tree and lint walked 400+ generated
            // files (214k errors); like `.next/`, it is never source.
            '.open-next/**',
            'node_modules/**',
            'supabase/functions/**',
            '.agent/**',
            '.agents/**',
            '.opencode/**',
            'docs/**',
            'public/**',
            'coverage/**',
            'run_migration.js',
        ],
    },
    ...tseslint.configs.recommended,
    {
        plugins: {
            'react-hooks': reactHooks,
        },
        rules: {
            // Correctness — this rule is why the #321 regression shipped. Hard error.
            'react-hooks/rules-of-hooks': 'error',
            // Style/policy — several run-once effects deliberately omit deps.
            // Surface it, never gate on it.
            'react-hooks/exhaustive-deps': 'warn',
        },
    },
    {
        rules: {
            'no-unused-vars': 'off',
            // Burned down 2026-09-23 — style gates are errors again.
            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                    ignoreRestSiblings: true,
                },
            ],
            '@typescript-eslint/no-explicit-any': 'error',
            'no-console': 'off',
            'no-empty': ['error', { allowEmptyCatch: true }],
            'no-constant-condition': ['error', { checkLoops: false }],
            'prefer-const': 'error',
            eqeqeq: ['error', 'smart'],
        },
    }
);
