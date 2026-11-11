import {configDefaults,defineConfig} from 'vitest/config';

export default defineConfig({
 test:{
  exclude:[...configDefaults.exclude,'**/dist/**','**/generated/**','**/e2e/**'],
  // Bound parallel framework/WASM initialization on developer machines and CI.
  maxWorkers:4,
  hookTimeout:30_000,
 },
});
