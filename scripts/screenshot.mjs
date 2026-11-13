#!/usr/bin/env node
// Capture a screenshot of a page with headless Chromium (software WebGL).
// Usage: node scripts/screenshot.mjs <url> <out.png> [--width=1440] [--height=900] [--wait=<selector>] [--delay=ms] [--mobile]
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const flags = Object.fromEntries(
  args.filter((a) => a.startsWith('--')).map((a) => {
    const body = a.slice(2);
    const eq = body.indexOf('=');
    return eq === -1 ? [body, 'true'] : [body.slice(0, eq), body.slice(eq + 1)];
  }),
);
const [url, out = 'screenshot.png'] = positional;
if (!url) {
  console.error('usage: screenshot.mjs <url> <out.png> [--width=] [--height=] [--wait=selector] [--delay=ms] [--mobile]');
  process.exit(2);
}
const mobile = flags.mobile === 'true';
const width = Number(flags.width ?? (mobile ? 390 : 1440));
const height = Number(flags.height ?? (mobile ? 844 : 900));

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const context = await browser.newContext({
  viewport: { width, height },
  deviceScaleFactor: Number(flags.dpr ?? 1),
  hasTouch: mobile,
  isMobile: mobile,
  colorScheme: flags.scheme === 'dark' ? 'dark' : 'light',
});
const page = await context.newPage();
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log(`[console.${m.type()}]`, m.text());
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('requestfailed', (r) => console.log('[requestfailed]', r.url(), r.failure()?.errorText));
await page.goto(url, { waitUntil: 'load' });
if (flags.wait) await page.waitForSelector(flags.wait, { timeout: Number(flags.timeout ?? 45000) });
if (flags.delay) await page.waitForTimeout(Number(flags.delay));
await page.screenshot({ path: out, fullPage: false });
console.log('wrote', out);
await browser.close();
