/**
 * Phase 7: re-read $KEST balances so tiers follow them (a wallet that sold drops back to Free). Read-only
 * (balanceOf / decimals). Runs with the hourly rescans; off while the token address or threshold isn't set.
 */
import { HOLDER_MIN_KEST, setUserBalance, tierForBalance, usersForBalanceRefresh, type Db } from '@kestrion/db';
import { KEST, type EngineContext } from '@kestrion/engine';
import { erc20Abi } from 'viem';
import { errText } from './errors';

export async function refreshHolderTiers(db: Db, ctx: EngineContext, log: (m: string) => void): Promise<number> {
  const token = KEST.address;
  if (!token || HOLDER_MIN_KEST === null) return 0;
  const decimals = Number(await ctx.rpc.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' }));
  let changed = 0;
  for (const u of await usersForBalanceRefresh(db)) {
    try {
      const balance = await ctx.rpc.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [u.wallet as `0x${string}`] });
      const tier = tierForBalance(balance, decimals);
      await setUserBalance(db, u.wallet, balance, tier);
      if (tier !== u.tier) changed++;
    } catch (e) {
      log(`tiers: ${u.wallet}: ${errText(e)}`);
    }
  }
  if (changed) log(`tiers: ${changed} account(s) changed tier`);
  return changed;
}
