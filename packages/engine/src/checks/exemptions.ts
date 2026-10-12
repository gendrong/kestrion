/** Check 1: wallets the creator exempted from the launch snipe tax (Pons V2 only). */
import type { EngineConfig } from '../scoring/config';
import type { CheckResult, ScanData } from '../types';
import { pct, shortAddr } from '../util/format';
import { isFundingLinked, linkReasons, plural, unknown } from './helpers';

const ID = 'exemptions' as const;
const TITLE = 'Snipe-tax exemptions';

export function checkExemptions(d: ScanData, cfg: EngineConfig): CheckResult {
  const c = cfg.checks.exemptions;
  if (d.exemptions === 'not_applicable') {
    return {
      id: ID,
      title: TITLE,
      status: 'pass',
      value: { applicable: false, version: d.launch.version },
      explanation:
        'Pons V1 launch: V1 has no snipe-tax exemption list. It uses a 2-block launch protection instead (only the creator’s initial buy can execute on the launch block).',
    };
  }
  if (!d.exemptions.ok) return unknown(ID, TITLE, d.exemptions.error);

  const ex = d.exemptions.value;
  const wallets = ex.detected;
  const count = wallets.length;
  const funded = wallets.filter((w) => isFundingLinked(linkReasons(d, w.address)));
  const exemptSet = new Set(wallets.map((w) => w.address.toLowerCase()));
  const boughtByExempt = d.earlyTrades.ok
    ? d.earlyTrades.value
        .filter((t) => t.side === 'buy' && exemptSet.has(t.wallet.toLowerCase()))
        .reduce((s, t) => s + t.tokenAmount, 0n)
    : 0n;
  const supplyPct = pct(boughtByExempt, d.launch.totalSupply);
  const atLeast = ex.complete ? '' : 'at least ';

  const value = {
    exemptWallets: count,
    listComplete: ex.complete,
    declaredInLaunchTx: ex.declared ? ex.declared.length : null,
    fundedByOrSharingFundsWithCreator: funded.length,
    fundingTraced: d.linked.ok,
    boughtInEarlyWindowSupplyPct: supplyPct,
    snipeTaxWindowSeconds: ex.windowSeconds,
    wallets: wallets.slice(0, 10).map((w) => ({ address: w.address, evidence: w.via })),
  };

  if (count < c.warnAtCount) {
    return {
      id: ID,
      title: TITLE,
      status: 'pass',
      value,
      explanation: ex.complete
        ? 'No extra wallets were exempted from the launch snipe tax (only the creator, which the protocol exempts automatically).'
        : `No wallet was seen buying in the first ${ex.windowSeconds}s without the snipe tax. The full exemption list can’t be read for this launch (it was made through another contract).`,
    };
  }

  const fail =
    count >= c.failAtCount || (c.failIfLinkedToCreator && funded.length > 0) || supplyPct >= c.failAtSupplyPct;
  const parts = [`${atLeast}${plural(count, 'wallet')} exempt from the ${ex.windowSeconds}s launch snipe tax`];
  if (funded.length > 0) parts.push(`${funded.length} funded by or sharing funds with the creator (traced up to 2 hops)`);
  else parts.push(d.linked.ok ? 'none traced to the creator’s funding' : 'funding not traced');
  parts.push(`together they bought ${supplyPct}% of supply in the first ${d.earlyWindowBlocks} blocks`);
  const first = parts.join('; ');
  return {
    id: ID,
    title: TITLE,
    status: fail ? 'fail' : 'warn',
    value,
    explanation: `${first.charAt(0).toUpperCase()}${first.slice(1)}.${funded[0] ? ` Example: ${shortAddr(funded[0].address)}.` : ''}`,
  };
}
