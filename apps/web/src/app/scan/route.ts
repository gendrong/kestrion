/**
 * GET /scan?address=0x… — fallback for the search form before JavaScript has loaded (slow phones):
 * the browser submits the form natively and we redirect to the report page (invalid input shows an error there).
 */
import { normalizeAddress } from '@/lib/address';

export function GET(req: Request) {
  const url = new URL(req.url);
  const raw = (url.searchParams.get('address') ?? '').trim().slice(0, 100);
  const address = normalizeAddress(raw);
  const target = address ? `/t/${address}` : `/t/${encodeURIComponent(raw || 'empty')}`;
  return Response.redirect(new URL(target, url), 303);
}
