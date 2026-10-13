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

// Phase 4: creator pages, /today, /about, share images.

test('header links to Today, footer links to About', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Footer' }).getByRole('link', { name: 'How scoring works' }).click();
  await expect(page).toHaveURL('/about');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('How the score');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Today' }).click();
  await expect(page).toHaveURL('/today');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Today on');
});

test('about explains all eight checks with their weights and the disclaimer', async ({ page }) => {
  await page.goto('/about');
  await expect(page.getByRole('heading', { level: 3 })).toHaveCount(8);
  await expect(page.getByText('Unknown is never a pass.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Data, not advice. DYOR.' })).toBeVisible();
  await expect(page.getByText(/Warn\s+−10\s+· Fail\s+−25/).first()).toBeVisible();
});

test('creator page explains an invalid address', async ({ page }) => {
  await page.goto('/creator/nope');
  await expect(page.getByRole('heading', { name: /not a valid address/i })).toBeVisible();
});

test('creator API validates the address', async ({ request }) => {
  const res = await request.get('/api/v1/creator/hello');
  expect(res.status()).toBe(400);
  expect(await res.json()).toEqual({ error: { code: 'invalid_address', message: expect.any(String) } });
});

test('share image falls back to the default card', async ({ request }) => {
  const res = await request.get('/og/not-an-address', { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  expect(res.headers()['location']).toContain('/og-default.png');
  const img = await request.get('/og-default.png');
  expect(img.status()).toBe(200);
  expect(img.headers()['content-type']).toContain('image/png');
});

test('pages carry share metadata', async ({ page }) => {
  await page.goto('/about');
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /\/og-default\.png$/);
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image');
});

// Phase 5: accounts, watchlist, notifications.

test('watchlist and notifications ask to sign in', async ({ page }) => {
  await page.goto('/watchlist');
  await expect(page.getByRole('button', { name: 'Sign in with your wallet' })).toBeVisible();
  await page.goto('/notifications');
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in with your wallet' })).toBeVisible();
});

test('header shows a sign-in button when signed out', async ({ page }) => {
  await page.goto('/about');
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Sign in' })).toBeVisible();
});

test('account API: signed out, and changes need a same-origin request', async ({ request }) => {
  expect(await (await request.get('/api/me')).json()).toEqual({ user: null });
  expect((await request.post('/api/watchlist', { data: { token: '0x' + '1'.repeat(40), action: 'add' } })).status()).toBe(403);
  const origin = { headers: { origin: 'http://localhost:3100' } };
  expect((await request.post('/api/watchlist', { ...origin, data: { token: '0x' + '1'.repeat(40), action: 'add' } })).status()).toBe(401);
  expect((await request.post('/api/auth/verify', { ...origin, data: { message: 'hi', signature: '0x12' } })).status()).toBeGreaterThanOrEqual(400);
});

test('rescan API validates the address', async ({ request }) => {
  const res = await request.post('/api/v1/scan/hello');
  expect(res.status()).toBe(400);
  expect((await res.json()).error.code).toBe('invalid_address');
});

// Phase 6: public API keys, flags, admin.

test('API docs explain access and offer key management', async ({ page }) => {
  await page.goto('/api-docs');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Reports as');
  await expect(page.getByText('/api/v1/token/:address')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in with your wallet' })).toBeVisible();
});

test('admin is hidden from everyone who is not an admin', async ({ request }) => {
  expect((await request.get('/admin')).status()).toBe(404);
});

test('API keys: a bad key is refused, anonymous access still works', async ({ request }) => {
  const bad = await request.get('/api/v1/launches?limit=1', { headers: { Authorization: 'Bearer kest_' + 'x'.repeat(43) } });
  expect([401, 503]).toContain(bad.status()); // 503 only when the local build has no database
  const malformed = await request.get('/api/v1/launches?limit=1', { headers: { 'X-API-Key': 'nope' } });
  expect(malformed.status()).toBe(401);
  expect((await malformed.json()).error.code).toBe('invalid_api_key');
  const anon = await request.get('/api/v1/token/hello');
  expect(anon.status()).toBe(400);
});

test('rescans and key management need sign-in or a key', async ({ request }) => {
  expect([401, 503]).toContain((await request.post('/api/v1/scan/0x' + '1'.repeat(40))).status());
  expect((await request.get('/api/keys')).status()).toBe(401);
  expect((await request.post('/api/flags', { data: { token: '0x' + '1'.repeat(40), type: 'missed_risk' } })).status()).toBe(403);
});
