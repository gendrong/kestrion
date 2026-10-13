/** GET /api/auth/nonce — a one-time nonce for the Sign-In with Ethereum message (valid 10 minutes). */
import { saveNonce } from '@kestrion/db';
import { generateSiweNonce } from 'viem/siwe';
import { getDb } from '@/lib/db';
import { rateLimit } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const limit = await rateLimit('api', req.headers);
  if (!limit.ok) return Response.json({ error: 'Too many requests' }, { status: 429, headers: limit.headers });
  const db = getDb();
  if (!db) return Response.json({ error: 'Sign-in is unavailable right now' }, { status: 503 });
  const nonce = generateSiweNonce();
  await saveNonce(db, nonce);
  return Response.json({ nonce }, { headers: { 'Cache-Control': 'no-store' } });
}
