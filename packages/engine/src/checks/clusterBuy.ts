/** Check 2: share of supply bought right after launch by the creator and linked wallets. */
import type { EngineConfig } from '../scoring/config';
import type { CheckResult, ScanData } from '../types';
import { pct } from '../util/format';
import { approxSeconds, creatorSet, linkedSet, unknown } from './helpers';

const ID = 'clusterBuy' as const;
const TITLE = 'Creator cluster buy';

export function checkClusterBuy(d: ScanData, cfg: EngineConfig): CheckResult {
  const c = cfg.checks.clusterBuy;
  if (!d.earlyTrades.ok) return unknown(ID, TITLE, d.earlyTrades.error);

  const buys = d.earlyTrades.value.filter((t) => t.side === 'buy');
  const creators = creatorSet(d);
  const linked = linkedSet(d);
  const sum = (filter: (w: string) => boolean) =>
    buys.filter((t) => filter(t.wallet.toLowerCase())).reduce((s, t) => s + t.tokenAmount, 0n);

  const supply = d.launch.totalSupply;
  const allPct = pct(sum(() => true), supply);
  const creatorPct = pct(sum((w) => creators.has(w)), supply);
  const linkedPct = pct(sum((w) => linked.has(w)), supply);
  const linkedBuyers = new Set(buys.map((t) => t.wallet.toLowerCase()).filter((w) => linked.has(w))).size;
  const secs = approxSeconds(d.earlyWindowBlocks);

  const value = {
    windowBlocks: d.earlyWindowBlocks,
    windowSecondsApprox: secs,
    earlyBuys: buys.length,
    uniqueBuyers: new Set(buys.map((t) => t.wallet.toLowerCase())).size,
    allBuyersSupplyPct: allPct,
    creatorSupplyPct: creatorPct,
    creatorAndLinkedSupplyPct: linkedPct,
    linkedBuyers,
    linkingTraced: d.linked.ok,
  };

  const status = linkedPct >= c.failAtPct ? 'fail' : linkedPct >= c.warnAtPct ? 'warn' : d.linked.ok ? 'pass' : 'unknown';
  const traced = d.linked.ok
    ? ''
    : d.depth === 'quick'
      ? ' Quick scan: only the creator’s own wallets are counted; early buyers’ funding is traced in a full scan.'
      : ' Funding links could not be traced, so only the creator’s own wallets are counted.';
  return {
    id: ID,
    title: TITLE,
    status,
    value,
    explanation:
      `Creator and linked wallets (${linkedBuyers} buying) bought ${linkedPct}% of supply in the first ${d.earlyWindowBlocks} blocks (~${secs}s); ` +
      `the creator alone ${creatorPct}%; all buyers together ${allPct}%.${traced}`,
  };
}
