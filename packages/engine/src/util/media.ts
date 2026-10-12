/**
 * Token metadata is written by token creators and must never be trusted (CLAUDE.md §11).
 * Pure helpers (no network), safe to import in the browser via `@kestrion/engine/media`.
 */

/** IPFS CIDv0 (Qm…, 46 chars) or CIDv1 base32 (b…, lowercase). */
const CID_RE = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{50,100})$/;

/**
 * The IPFS content id of a logo URL, or null. Accepts `ipfs://<cid>[/path]` and `https://<any gateway>/ipfs/<cid>`.
 * Everything else (raw IPs, http://, random hosts, data: URIs) is rejected, so the site never loads arbitrary hosts.
 */
export function logoCid(url: string | null | undefined): string | null {
  if (!url) return null;
  const s = url.trim();
  let cid: string | undefined;
  const ipfsScheme = s.match(/^ipfs:\/\/(?:ipfs\/)?([^/?#]+)/i);
  if (ipfsScheme) cid = ipfsScheme[1];
  else {
    const gateway = s.match(/^https:\/\/[a-z0-9.-]+\/ipfs\/([^/?#]+)/i);
    if (gateway) cid = gateway[1];
  }
  return cid && CID_RE.test(cid) ? cid : null;
}

/** Only http(s) links to a host are allowed for social links; returns null otherwise. */
export function safeLink(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (!u.hostname.includes('.')) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export interface TokenMetadata {
  /** IPFS CID of the logo (already validated), if any. */
  logoCid: string | null;
  description: string;
  socials: { twitter: string | null; telegram: string | null; discord: string | null; website: string | null; farcaster: string | null };
}

/** Clean raw on-chain metadata into something safe to store and render as text. */
export function cleanMetadata(raw: {
  logo?: string;
  description?: string;
  socials?: Partial<Record<'twitter' | 'telegram' | 'discord' | 'website' | 'farcaster', string>>;
}): TokenMetadata {
  const s = raw.socials ?? {};
  return {
    logoCid: logoCid(raw.logo),
    // Plain text only; trimmed and capped. React escapes it when rendering.
    description: (raw.description ?? '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, 500),
    socials: {
      twitter: safeLink(s.twitter),
      telegram: safeLink(s.telegram),
      discord: safeLink(s.discord),
      website: safeLink(s.website),
      farcaster: safeLink(s.farcaster),
    },
  };
}
