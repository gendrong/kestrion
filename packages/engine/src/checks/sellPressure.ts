/** Check 8: share of their tokens the creator and linked wallets have sold or moved out. */
import type { EngineConfig } from '../scoring/config';
import type { CheckResult, ScanData } from '../types';
import { fmtAmount, pct } from '../util/format';
import { creatorSet, unknown } from './helpers';

const ID = 'sellPressure' as const;
const TITLE = 'Sell pressure';

export function checkSellPressure(d: ScanData, cfg: EngineConfig): CheckResult {
  const c = cfg.checks.sellPressure;
  if (!d.flows.ok) return unknown(ID, TITLE, d.flows.error);

  const flows = d.flows.value;
  const creators = creatorSet(d);
  const sum = (key: 'received' | 'sent' | 'lockedOrBurned', onlyCreator = false) =>
    flows.filter((f) => !onlyCreator || creators.has(f.address.toLowerCase())).reduce((s, f) => s + f[key], 0n);
  const received = sum('received');
  const sent = sum('sent');
  const locked = sum('lockedOrBurned');
  const creatorReceived = sum('received', true);
  const creatorSent = sum('sent', true);
  const soldPct = Math.min(100, pct(sent, received));
  const lockedPct = Math.min(100, pct(locked, received));
  const dec = d.launch.decimals;
  const value = {
    walletsChecked: flows.length,
    tokensReceived: fmtAmount(received, dec, 0),
    tokensSentOut: fmtAmount(sent, dec, 0),
    soldOrMovedPct: soldPct,
    lockedOrBurnedPct: lockedPct,
    creatorSoldOrMovedPct: Math.min(100, pct(creatorSent, creatorReceived)),
    linkingTraced: d.linked.ok,
  };
  if (received === 0n) {
    return {
      id: ID,
      title: TITLE,
      status: 'pass',
      value,
      explanation: `The creator and linked wallets (${flows.length} checked) have not received any of this token.`,
    };
  }
  const status = soldPct >= c.failAtPct ? 'fail' : soldPct >= c.warnAtPct ? 'warn' : 'pass';
  return {
    id: ID,
    title: TITLE,
    status,
    value,
    explanation:
      `Creator and linked wallets received ${value.tokensReceived} tokens and have sold or moved out ${soldPct}% of them since launch (creator alone: ${value.creatorSoldOrMovedPct}%).` +
      (lockedPct > 0 ? ` ${lockedPct}% went to token lockers or burn addresses (not counted as selling).` : ''),
  };
}
