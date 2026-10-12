/** Check 4: the creator's earlier launches: how many, how many died fast, repeated names/tickers. */
import type { EngineConfig } from '../scoring/config';
import type { CheckResult, ScanData } from '../types';
import { plural, unknown } from './helpers';

const ID = 'creatorHistory' as const;
const TITLE = 'Creator history';

export function checkCreatorHistory(d: ScanData, cfg: EngineConfig): CheckResult {
  const c = cfg.checks.creatorHistory;
  if (!d.priorLaunches.ok) return unknown(ID, TITLE, d.priorLaunches.error);

  const { launches, total, partial } = d.priorLaunches.value;
  const died = launches.filter((l) => l.diedFast === true).length;
  const decided = launches.filter((l) => l.diedFast !== null).length;
  const graduated = launches.filter((l) => l.graduated === true).length;
  const sym = d.launch.symbol.toLowerCase();
  const name = d.launch.name.toLowerCase();
  const repeated = launches.filter((l) => l.symbol.toLowerCase() === sym || l.name.toLowerCase() === name).length;

  const value = {
    priorLaunches: total,
    analysed: launches.length,
    diedFast: died,
    outcomeKnown: decided,
    graduated,
    repeatedNameOrTicker: repeated,
    searchPartial: partial,
    diedFastRule: `liquidity fell ≥${c.diedFast.dropPct}% within ${c.diedFast.windowHours}h`,
    recent: launches.slice(0, 5).map((l) => ({ token: l.token, symbol: l.symbol, graduated: l.graduated, diedFast: l.diedFast })),
  };
  const partialNote = partial ? ' The search may be incomplete (launches through other contracts are not attributed).' : '';

  if (total === 0) {
    return { id: ID, title: TITLE, status: 'pass', value, explanation: `No earlier Pons launches found from this creator wallet.${partialNote}` };
  }
  const ratio = decided > 0 ? died / decided : 0;
  const status =
    (died >= c.failAtDiedFast && ratio >= c.failAtDiedFastRatio) || total >= c.failAtPriorLaunches
      ? 'fail'
      : total >= c.warnAtPriorLaunches || died >= 1 || repeated >= 1
        ? 'warn'
        : 'pass';
  const outcome =
    launches.length > 0
      ? ` Of the ${launches.length} most recent: ${died} lost ≥${c.diedFast.dropPct}% of their liquidity within ${c.diedFast.windowHours}h, ${graduated} graduated, ${launches.length - decided} outcome unknown.`
      : '';
  const rep = repeated > 0 ? ` ${plural(repeated, 'earlier launch')} reused this name or ticker.` : '';
  return {
    id: ID,
    title: TITLE,
    status,
    value,
    explanation: `${plural(total, 'earlier launch')} by this creator.${outcome}${rep}${partialNote}`,
  };
}
