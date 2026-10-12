'use client';

import { useState } from 'react';
import { initials } from '@/lib/format';

/** Token logo through our IPFS proxy (/img/:cid); falls back to initials. Never loads other hosts. */
export function TokenAvatar({ name, logoCid, size = 40 }: { name: string; logoCid: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size };
  if (logoCid && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- proxied, validated IPFS image
      <img
        src={`/img/${logoCid}`}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
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
