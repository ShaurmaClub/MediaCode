import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    ignores: ['dist/**', 'node_modules/**', 'scratch_test_files/**', 'Proverka/**', 'test-results/**']
  },
  {
    rules: {
      'no-unused-vars': 'warn',
      'no-undef': 'off',
      'no-empty': 'off',
      'no-useless-assignment': 'off',
      'no-prototype-builtins': 'off',
      'no-useless-escape': 'off',
      'no-dupe-keys': 'warn'
    }
  }
];
