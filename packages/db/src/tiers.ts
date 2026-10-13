/**
 * Account tiers (CLAUDE.md §10). ALL per-tier limits and the Holder rule live here.
 * Holder tier = wallets holding at least HOLDER_MIN_KEST $KEST. Off (everyone Free) until both the token address
 * (packages/engine/src/chain/config.ts → KEST.address) and HOLDER_MIN_KEST are set.
 */
export type Tier = 'free' | 'holder';

export const TIERS: Record<Tier, { watchlist: number; follows: number; apiPerMinute: number }> = {
  free: { watchlist: 5, follows: 3, apiPerMinute: 600 },
  // "Unlimited" in the product; a generous cap keeps one account from filling the database.
  holder: { watchlist: 500, follows: 200, apiPerMinute: 3000 },
};

/** Whole $KEST needed for the Holder tier (a decimal string, e.g. '100000'). null = Holder tier off. */
export const HOLDER_MIN_KEST: string | null = null;

/** Refresh holders' balances this often (the jobs do it; a sign-in reads it right away). */
export const BALANCE_REFRESH_MS = 60 * 60_000;

export const tierOf = (t: string | null | undefined): Tier => (t === 'holder' ? 'holder' : 'free');

/** "100000.5" whole tokens → raw units for a token with `decimals`. */
export function toRawUnits(amount: string, decimals: number): bigint {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(amount.trim());
  if (!m) throw new Error(`Invalid token amount: ${amount}`);
  const frac = (m[2] ?? '').slice(0, decimals).padEnd(decimals, '0');
  return BigInt(m[1]!) * 10n ** BigInt(decimals) + (decimals > 0 ? BigInt(frac || '0') : 0n);
}

/** The tier a balance earns. Without a threshold (feature off) everyone is Free. */
export function tierForBalance(balance: bigint, decimals: number, minWhole: string | null = HOLDER_MIN_KEST): Tier {
  if (minWhole === null) return 'free';
  return balance >= toRawUnits(minWhole, decimals) ? 'holder' : 'free';
}
