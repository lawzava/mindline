import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/** Flat config: JS + TypeScript + Svelte 5, with Prettier owning formatting. */
export default ts.config(
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs['flat/recommended'],
	prettier,
	...svelte.configs['flat/prettier'],
	{
		languageOptions: {
			globals: { ...globals.browser, ...globals.node }
		}
	},
	{
		files: ['**/*.svelte'],
		languageOptions: {
			parserOptions: { parser: ts.parser }
		}
	},
	{
		rules: {
			// TypeScript checks undefined references far more accurately than ESLint
			// (and knows DOM lib types like BufferSource); let it own that.
			'no-undef': 'off',
			// Allow intentionally-unused identifiers prefixed with `_`.
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }
			],
			// Framework-preference / stylistic Svelte rules: surfaced as warnings,
			// not launch blockers (tracked as follow-up cleanups).
			'svelte/no-navigation-without-resolve': 'warn',
			'svelte/prefer-svelte-reactivity': 'warn',
			'svelte/require-each-key': 'warn',
			'svelte/no-unused-svelte-ignore': 'warn'
		}
	},
	{
		// Tests use fake globals (indexedDB) and loose typing by design.
		files: ['tests/**'],
		rules: {
			'@typescript-eslint/no-explicit-any': 'off',
			'no-global-assign': 'off',
			'@typescript-eslint/no-unused-vars': 'warn'
		}
	},
	{
		ignores: [
			'build/',
			'.svelte-kit/',
			'dist/',
			'node_modules/',
			'playwright-report/',
			'test-results/',
			'static/'
		]
	}
);
