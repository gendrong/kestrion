/**
 * Fetch Kestrion reports with an API key (Node 18+, no packages needed).
 *
 *   KESTRION_API_KEY=kest_... node examples/fetch-report.mjs [token address]
 *
 * Create a key at https://kestrion.autora.workers.dev/api-docs (sign in with your wallet). Without a key the API
 * still works with a lower limit. Data, not advice.
 */
const BASE = process.env.KESTRION_URL ?? 'https://kestrion.autora.workers.dev';
const key = process.env.KESTRION_API_KEY;
const headers = key ? { Authorization: `Bearer ${key}` } : {};

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { headers });
  const body = await res.json();
  if (!res.ok && res.status !== 202) throw new Error(`${res.status} ${body.error?.code}: ${body.error?.message}`);
  return { status: res.status, access: res.headers.get('x-kestrion-access'), limit: res.headers.get('x-ratelimit-limit'), body };
}

let token = process.argv[2];
if (!token) {
  const feed = await get('/api/v1/launches?limit=3');
  console.log(`access: ${feed.access} (limit ${feed.limit}/min)`);
  console.log('newest launches:');
  for (const t of feed.body.data) console.log(`  ${t.symbol.padEnd(12)} ${String(t.score).padStart(3)}  ${t.label.padEnd(9)}  ${t.address}`);
  token = feed.body.data[0]?.address;
}
const r = await get(`/api/v1/token/${token}`);
if (r.status === 202) {
  console.log(`${token} is not scanned yet: queued (${r.body.meta.status}). Try again in ~5 minutes.`);
} else {
  const report = r.body.data;
  console.log(`\n${report.token.name} ($${report.token.symbol}): ${report.score}/100 ${report.label} (${report.scanDepth ?? 'full'} scan, ${r.body.meta.scannedAt})`);
  console.log(report.summary);
  for (const c of report.checks) console.log(`  ${c.status.padEnd(7)} -${String(c.deduction).padEnd(3)} ${c.title}: ${c.explanation}`);
}
