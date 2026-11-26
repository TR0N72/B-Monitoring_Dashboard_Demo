// Minimal rule set without extra eslint packages; expand to recommended if needed.
const nodeGlobals = Object.fromEntries([
  'require', 'module', 'exports', '__dirname', '__filename', 'process', 'console', 'Buffer',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'URL', 'URLSearchParams',
  'AbortSignal', 'AbortController', 'fetch', 'FormData', 'Blob', 'TextEncoder', 'TextDecoder',
].map((n) => [n, 'readonly']));
const jestGlobals = Object.fromEntries([
  'describe', 'it', 'test', 'expect', 'beforeAll', 'afterAll', 'beforeEach', 'afterEach', 'jest',
].map((n) => [n, 'readonly']));

export default [
  { ignores: ['coverage/**', 'node_modules/**'] },
  {
    files: ['src/**/*.js', 'scripts/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: nodeGlobals },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-dupe-keys': 'error',
      'no-unreachable': 'error',
    },
  },
  { files: ['src/__tests__/**/*.js'], languageOptions: { globals: { ...nodeGlobals, ...jestGlobals } } },
];
