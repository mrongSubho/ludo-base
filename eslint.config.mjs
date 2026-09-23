// Flat ESLint config — Next 16 removed `next lint`; this is the honest lint gate.
// Avoid FlatCompat + eslint-config-next (circular plugin graph on ESLint 9 / Next 16).
import tseslint from 'typescript-eslint';

export default tseslint.config(
    {
        ignores: [
            '.next/**',
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
            'react-hooks': {
                rules: {
                    'exhaustive-deps': { meta: { docs: { description: 'stub' } }, create: () => ({}) },
                    'rules-of-hooks': { meta: { docs: { description: 'stub' } }, create: () => ({}) },
                },
            },
            '@next/next': {
                rules: {
                    'no-img-element': { meta: { docs: { description: 'stub' } }, create: () => ({}) },
                },
            },
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
