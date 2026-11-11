import {defineConfig,devices} from '@playwright/test';

export default defineConfig({
 testDir:'./apps/web/e2e',
 fullyParallel:false,
 workers:1,
 timeout:120_000,
 expect:{timeout:15_000},
 reporter:'list',
 use:{baseURL:process.env.E2E_WEB_URL??process.env.NEXT_PUBLIC_APP_URL??'http://localhost:3000',trace:'retain-on-failure',screenshot:'only-on-failure',...devices['Desktop Chrome']},
});
