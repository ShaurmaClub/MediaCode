import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    ignores: ['dist/**', 'node_modules/**', 'scratch_test_files/**', 'Proverka/**', 'test-results/**']
  },
  {
    files: ['src/**/*.{js,jsx}', 'tests/**/*.{js,jsx}', 'server/**/*.{js,jsx}', '*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: {
          jsx: true
        }
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        describe: 'readonly',
        test: 'readonly',
        assert: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': 'warn',
      'no-empty': 'off',
      'no-useless-assignment': 'off',
      'no-prototype-builtins': 'off',
      'no-useless-escape': 'off',
      'no-dupe-keys': 'warn',
      'no-undef': 'warn'
    }
  }
];
