import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.MAPZ_E2E_PORT ?? 4317);

// Headless Chromium has no GPU here, so WebGL runs on SwiftShader.
const launchOptions = {
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
};

/**
 * Two projects run the same specs: a desktop window with a mouse and a keyboard, and a phone with
 * fingers. A test tagged @desktop or @phone runs in that project only; untagged tests run in both.
 * The one test tagged @live loads from the public tile service and is skipped unless MAPZ_LIVE=1.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // Miles and "en" wording, whatever the machine running the tests is set to.
    locale: 'en-US',
    // Recording a trace of every test adds about a fifth to the run, so one is kept only for a test
    // that is being retried (CI). Elsewhere a failure leaves a screenshot; add --trace on for more.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    launchOptions,
  },
  projects: [
    {
      name: 'desktop',
      grepInvert: /@phone/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'phone',
      grepInvert: /@desktop/,
      use: { ...devices['Pixel 7'] },
    },
  ],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
