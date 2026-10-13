/**
 * Account tiers (CLAUDE.md §10). ALL per-tier limits live here.
 * Holder tier = wallets holding enough $KEST; it stays unused until the token address is set (Phase 7).
 */
export type Tier = 'free' | 'holder';

export const TIERS: Record<Tier, { watchlist: number; follows: number }> = {
  free: { watchlist: 5, follows: 3 },
  // "Unlimited" in the product; a generous cap keeps one account from filling the database.
  holder: { watchlist: 500, follows: 200 },
};

export const tierOf = (t: string | null | undefined): Tier => (t === 'holder' ? 'holder' : 'free');
