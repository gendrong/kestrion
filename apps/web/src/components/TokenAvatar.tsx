'use client';

import { useState } from 'react';
import { initials } from '@/lib/format';

/**
 * Token logo, loaded by the browser straight from allowlisted IPFS gateways (no request to our Worker, whose free
 * plan allows 100k requests a day; a feed page used to cost one request per logo). Only a validated CID is ever put
 * in the URL, never raw token metadata; an <img> can't run scripts, even from an SVG. Falls back to the next gateway,
 * then to initials. The gateways must match img-src in next.config.mjs.
 */
const CID_RE = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{50,100})$/;
const GATEWAYS = ['https://ipfs.filebase.io/ipfs/', 'https://4everland.io/ipfs/'];

export function TokenAvatar({ name, logoCid, size = 40 }: { name: string; logoCid: string | null; size?: number }) {
  const [attempt, setAttempt] = useState(0);
  const style = { width: size, height: size };
  if (logoCid && CID_RE.test(logoCid) && attempt < GATEWAYS.length) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- validated IPFS CID on an allowlisted gateway
      <img
        src={`${GATEWAYS[attempt]}${logoCid}`}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setAttempt((a) => a + 1)}
        className="shrink-0 rounded-full bg-line-soft object-cover"
        style={style}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-full bg-line-soft font-display text-sm font-bold"
      style={style}
    >
      {initials(name || '?')}
    </span>
  );
}
