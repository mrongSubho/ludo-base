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
        // Existing files disable react-hooks / @next rules from the old
        // eslint-config-next setup. Register stubs so those directives don't error.
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
            // Style debt is warn until burn-down (stable-build gate keeps CI honest
            // while we fix the existing unused/prefer-const surface incrementally).
            '@typescript-eslint/no-unused-vars': [
                'warn',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
            ],
            '@typescript-eslint/no-explicit-any': 'warn',
            'no-console': 'off',
            'no-empty': ['error', { allowEmptyCatch: true }],
            'no-constant-condition': ['error', { checkLoops: false }],
            'prefer-const': 'warn',
            eqeqeq: ['error', 'smart'],
        },
    }
);
