// Dev helper: phone-sized screenshots of the home page and the first report in the feed.
// Usage: node e2e/screenshots.mjs <outDir> [baseUrl]   (default base: http://localhost:3100)
import { chromium, devices } from '@playwright/test';

const out = process.argv[2] ?? '.';
const base = process.argv[3] ?? 'http://localhost:3100';
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['Pixel 7'] });
const page = await ctx.newPage();
await page.goto(`${base}/`, { waitUntil: 'networkidle' });
await page.screenshot({ path: `${out}/home-mobile.png`, fullPage: true });
const first = page.locator('#feed a[href^="/t/"]').first();
if (await first.count()) {
  await first.click();
  await page.getByText(/Score out of 100|Queued for scanning/).first().waitFor({ timeout: 30_000 });
  await page.screenshot({ path: `${out}/report-mobile.png`, fullPage: true });
}
await browser.close();
console.log('screenshots saved to', out);
