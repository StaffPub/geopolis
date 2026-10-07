import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'client/dist/**',
      'data/**',
      'coverage/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': 'off',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  {
    files: ['client/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // React 18 + JSX transform : pas d'import React requis
      '@typescript-eslint/no-empty-object-type': 'off',
      // Garde-fou STRUCTUREL : hooks jamais conditionnels (error React #310)
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
);
