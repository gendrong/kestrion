import { expect, test } from '@playwright/test';

const GRAIL = '0xaF590d88E23B063190993BCf77489C8A6Fb86C32';

test('home shows the tagline, disclaimer and search', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Strikes before the');
  await expect(page.getByText('Data, not advice. DYOR.')).toBeVisible();
  await expect(page.getByText('not affiliated with Robinhood Markets or Pons Labs')).toBeVisible();
  await expect(page.getByRole('searchbox').or(page.getByLabel('Token address'))).toBeVisible();
});

test('search rejects an invalid address', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle'); // wait for hydration so the client-side check runs
  await page.getByLabel('Token address').fill('hello');
  await page.getByRole('button', { name: /scan/i }).click();
  // (Next.js also renders an empty role="alert" route announcer, so match the message text.)
  await expect(page.getByRole('alert').filter({ hasText: 'valid address' })).toBeVisible();
  await expect(page).toHaveURL('/');
});

test('search routes a valid address to its report page', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Token address').fill(GRAIL);
  await page.getByRole('button', { name: /scan/i }).click();
  await expect(page).toHaveURL(`/t/${GRAIL}`);
  // A stored report, the queue notice, or (without a database) the unavailable notice.
  await expect(page.getByText(/Score out of 100|Queued for scanning|temporarily unavailable/).first()).toBeVisible();
});

test('search works before JavaScript loads (no-JS fallback)', async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.getByLabel('Token address').fill('hello');
  await page.getByRole('button', { name: /scan/i }).click();
  await expect(page.getByRole('heading', { name: /not a valid address/i })).toBeVisible();
  await ctx.close();
});

test('report page explains an invalid address', async ({ page }) => {
  await page.goto('/t/not-an-address');
  await expect(page.getByRole('heading', { name: /not a valid address/i })).toBeVisible();
});

test('API returns a consistent error for an invalid address, with CORS', async ({ request }) => {
  const res = await request.get('/api/v1/token/hello');
  expect(res.status()).toBe(400);
  expect(res.headers()['access-control-allow-origin']).toBe('*');
  expect(await res.json()).toEqual({ error: { code: 'invalid_address', message: expect.any(String) } });
});

test('home shows the live feed section', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Live launches' })).toBeVisible();
});

test('launches API validates its query and returns the standard shape', async ({ request }) => {
  const res = await request.get('/api/v1/launches?risk=nonsense&limit=5');
  expect([200, 503]).toContain(res.status());
  const body = await res.json();
  if (res.status() === 200) expect(Array.isArray(body.data)).toBe(true);
  else expect(body.error.code).toBe('unavailable');
});

test('image proxy refuses anything that is not an IPFS CID', async ({ request }) => {
  expect((await request.get('/img/not-a-cid')).status()).toBe(404);
  expect((await request.get('/img/..%2F..%2Fetc%2Fpasswd')).status()).toBe(404);
});

test('stored report renders (E2E_LIVE=1, needs the database)', async ({ page }, info) => {
  test.skip(!process.env.E2E_LIVE || info.project.name !== 'mobile', 'needs a database with scans: set E2E_LIVE=1');
  await page.goto('/');
  const first = page.locator('#feed a[href^="/t/"]').first();
  await first.click();
  await expect(page.getByText('Score out of 100')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'All checks' })).toBeVisible();
});
