/** Check 5: creator wallet age and where its first funds came from. */
import type { EngineConfig } from '../scoring/config';
import type { CheckResult, FunderKind, ScanData } from '../types';
import { fmtDuration, round, shortAddr } from '../util/format';
import { unknown } from './helpers';

const ID = 'creatorWallet' as const;
const TITLE = 'Creator wallet';

const KIND_TEXT: Record<FunderKind, string> = {
  exchange: 'an exchange',
  bridge: 'a bridge',
  launch_proceeds: 'proceeds of a Pons launch',
  contract: 'a contract',
  wallet: 'another wallet',
  none: 'no incoming ETH transfer found',
  unknown: 'an unknown source',
};

export function checkCreatorWallet(d: ScanData, cfg: EngineConfig): CheckResult {
  const c = cfg.checks.creatorWallet;
  if (!d.creatorWallet.ok) return unknown(ID, TITLE, d.creatorWallet.error);

  const p = d.creatorWallet.value;
  if (p.ageDays === undefined) return unknown(ID, TITLE, 'no transaction history found for the creator wallet');
  const fresh = p.ageDays < c.freshDays;
  const funderAge = p.funderProfile?.ageDays;
  const funderFresh = funderAge !== undefined && funderAge < c.freshDays;

  const value = {
    creator: p.address,
    walletAgeDays: round(p.ageDays, 2),
    firstSeen: p.firstSeen ? new Date(p.firstSeen * 1000).toISOString() : null,
    fundingSource: p.funderKind,
    funder: p.funder ?? null,
    funderLabel: p.funderLabel ?? null,
    funderWalletAgeDays: funderAge !== undefined ? round(funderAge, 2) : null,
    freshThresholdDays: c.freshDays,
  };

  const status =
    fresh && p.funderKind === 'wallet' && funderFresh
      ? 'fail'
      : fresh || p.funderKind === 'launch_proceeds'
        ? 'warn'
        : 'pass';
  const funderText = `${KIND_TEXT[p.funderKind]}${p.funder ? ` (${p.funderLabel ? `${p.funderLabel}, ` : ''}${shortAddr(p.funder)})` : ''}`;
  const extra = funderFresh ? ` The funding wallet is also new (${fmtDuration((funderAge as number) * 86400)} old).` : '';
  return {
    id: ID,
    title: TITLE,
    status,
    value,
    explanation: `Creator wallet is ${fmtDuration(p.ageDays * 86400)} old; first funded by ${funderText}.${extra}`,
  };
}
