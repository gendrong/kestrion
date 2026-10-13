/**
 * Wallet profiling: age, first funder, and what kind of source the funder is.
 * Linking: which early buyers / exempt wallets connect to the creator through funding (≤ 2 hops).
 */
import type { Address } from 'viem';
import { ponsV2CurveAbi } from '../chain/abis';
import { PONS_PAYOUT_CONTRACTS } from '../chain/config';
import type { EngineContext } from '../context';
import type { EngineConfig } from '../scoring/config';
import type { CreatorProfile, ExemptionData, FunderKind, LaunchInfo, LinkedWallet, Result, Trade, WalletProfile } from '../types';
import { sameAddr, uniqAddrs } from '../util/format';
import { mapLimit } from '../util/limiter';

const BRIDGE_RE = /(bridge|relay|across|stargate|layerzero|hop protocol|orbiter|wormhole|socket|li\.?fi|jumper|gateway|inbox|outbox|rhino|debridge|synapse)/i;
const EXCHANGE_RE =
  /(binance|coinbase|okx|okex|bybit|kraken|kucoin|gate\.?io|mexc|bitget|htx|huobi|crypto\.com|bitfinex|bitstamp|gemini|upbit|bithumb|robinhood|exchange|hot ?wallet)/i;

/** Classify a funder from its public labels. Bridges are checked first ("Robinhood Chain: Bridge" is a bridge). */
export function classifyLabels(labels: string[], isContract: boolean): FunderKind {
  const text = labels.join(' | ');
  if (BRIDGE_RE.test(text)) return 'bridge';
  if (EXCHANGE_RE.test(text)) return 'exchange';
  return isContract ? 'contract' : 'wallet';
}

export class WalletProfiler {
  private readonly profiles: Map<string, Promise<WalletProfile>>;
  private readonly funders: Map<string, Promise<{ kind: FunderKind; label?: string }>>;

  constructor(
    private readonly ctx: EngineContext,
    private readonly now: number,
  ) {
    // Shared across the scans of a job run, so a wallet or funder is looked up once per run.
    this.profiles = ctx.shared.profiles;
    this.funders = ctx.shared.funders;
  }

  profile(address: Address): Promise<WalletProfile> {
    const key = address.toLowerCase();
    let p = this.profiles.get(key);
    if (!p) {
      p = this.build(address);
      this.profiles.set(key, p);
    }
    return p;
  }

  private async build(address: Address): Promise<WalletProfile> {
    const explorer = this.ctx.explorer;
    if (!explorer) throw new Error('Explorer API needed for wallet history');
    // Address labels are only fetched for funders (classifyFunder), not for every profiled wallet.
    // Normal transactions first; internal ones (ETH sent by contracts) only when no incoming ETH shows up there.
    const txs = await explorer.firstTransactions(address);
    const fundedNormally = txs.some((t) => !t.isError && sameAddr(t.to, address) && t.value > 0n && !sameAddr(t.from, address));
    const internals = fundedNormally ? [] : await explorer.firstInternalTransactions(address);
    const all = [...txs, ...internals].filter((t) => !t.isError);
    const firstSeen = all.length ? Math.min(...all.map((t) => t.timeStamp)) : undefined;
    const incoming = all
      .filter((t) => sameAddr(t.to, address) && t.value > 0n && !sameAddr(t.from, address))
      .sort((a, b) => a.timeStamp - b.timeStamp);
    const first = incoming[0];
    const funderInfo = first ? await this.classifyFunder(first.from) : { kind: 'none' as FunderKind };
    // Age is relative to this scan's time (cached profiles may come from an earlier scan of the run).
    return {
      address,
      firstSeen,
      ageDays: firstSeen !== undefined ? (this.now - firstSeen) / 86400 : undefined,
      funder: first?.from,
      funderKind: funderInfo.kind,
      funderLabel: funderInfo.label,
      fundedAt: first?.timeStamp,
    };
  }

  classifyFunder(funder: Address): Promise<{ kind: FunderKind; label?: string }> {
    const key = funder.toLowerCase();
    let p = this.funders.get(key);
    if (!p) {
      p = (async () => {
        if (PONS_PAYOUT_CONTRACTS.some((c) => sameAddr(c, funder))) return { kind: 'launch_proceeds' as FunderKind, label: 'Pons payout contract' };
        const info = await this.ctx.explorer!.addressInfo(funder);
        const kind = classifyLabels(info.labels, info.isContract);
        if (kind === 'contract' && (await this.isPonsCurve(funder))) {
          return { kind: 'launch_proceeds' as FunderKind, label: 'Pons V2 curve (token sale proceeds)' };
        }
        return { kind, label: info.labels[0] };
      })();
      this.funders.set(key, p);
    }
    return p;
  }

  /** A contract answering the V2 curve getters is treated as a Pons curve. */
  private async isPonsCurve(address: Address): Promise<boolean> {
    try {
      await Promise.all([
        this.ctx.rpc.readContract({ address, abi: ponsV2CurveAbi, functionName: 'graduationThreshold' }),
        this.ctx.rpc.readContract({ address, abi: ponsV2CurveAbi, functionName: 'realQuoteReserve' }),
      ]);
      return true;
    } catch {
      return false;
    }
  }
}

/** Creator wallet profile; `secondHop` also profiles the funding wallet (full scans only: more explorer calls). */
export async function buildCreatorProfile(profiler: WalletProfiler, creator: Address, secondHop = true): Promise<CreatorProfile> {
  const p = await profiler.profile(creator);
  if (secondHop && p.funder && p.funderKind === 'wallet') {
    try {
      return { ...p, funderProfile: await profiler.profile(p.funder) };
    } catch {
      return p;
    }
  }
  return p;
}

/** Addresses that ARE the creator (creator, launch tx sender, EOA deployer, fee recipient). */
export function creatorIdentities(launch: LaunchInfo): { address: Address; reason: string }[] {
  const out: { address: Address; reason: string }[] = [{ address: launch.creator, reason: 'creator' }];
  const add = (a: Address | undefined, reason: string) => {
    if (a && !out.some((o) => sameAddr(o.address, a))) out.push({ address: a, reason });
  };
  add(launch.launchTxFrom, 'sent the launch transaction');
  if (!launch.deployerIsContract) add(launch.deployer, 'deployer');
  add(launch.creatorFeeRecipient, 'creator fee recipient');
  return out;
}

export const FUNDING_LINK_REASONS = [
  'funded by the creator',
  'funded by the creator (2 hops)',
  'same funding wallet as the creator',
  'shares a funding wallet with the creator (2 hops)',
  'funded the creator',
];

export async function computeLinkedWallets(
  ctx: EngineContext,
  profiler: WalletProfiler,
  launch: LaunchInfo,
  earlyTrades: Result<Trade[]>,
  exemptions: Result<ExemptionData> | 'not_applicable',
  creatorProfile: Result<CreatorProfile>,
  cfg: EngineConfig,
): Promise<LinkedWallet[]> {
  const ids = creatorIdentities(launch);
  const isCreator = (a?: Address) => !!a && ids.some((i) => sameAddr(i.address, a));
  const linked = new Map<string, LinkedWallet>();
  const add = (address: Address, reason: string) => {
    const k = address.toLowerCase();
    const w = linked.get(k) ?? { address, reasons: [] };
    if (!w.reasons.includes(reason)) w.reasons.push(reason);
    linked.set(k, w);
  };
  for (const i of ids) add(i.address, i.reason);

  const exempt = exemptions !== 'not_applicable' && exemptions.ok ? exemptions.value.detected.map((d) => d.address) : [];
  for (const e of exempt) add(e, 'snipe-tax exempt (chosen by the creator)');

  const creatorFunder =
    creatorProfile.ok && creatorProfile.value.funderKind === 'wallet' ? creatorProfile.value.funder : undefined;

  const earlyBuyers = earlyTrades.ok ? earlyTrades.value.filter((t) => t.side === 'buy').map((t) => t.wallet) : [];
  const candidates = uniqAddrs([...exempt, ...earlyBuyers])
    .filter((a) => !isCreator(a))
    .slice(0, cfg.maxLinkedCandidates);

  let failures = 0;
  await mapLimit(candidates, 6, async (c) => {
    try {
      if (creatorFunder && sameAddr(c, creatorFunder)) add(c, 'funded the creator');
      const p1 = await profiler.profile(c);
      const f1 = p1.funder;
      if (!f1) return;
      if (isCreator(f1)) return add(c, 'funded by the creator');
      if (creatorFunder && sameAddr(f1, creatorFunder)) return add(c, 'same funding wallet as the creator');
      if (p1.funderKind !== 'wallet') return;
      const p2 = await profiler.profile(f1);
      if (isCreator(p2.funder)) return add(c, 'funded by the creator (2 hops)');
      if (creatorFunder && sameAddr(p2.funder, creatorFunder)) add(c, 'shares a funding wallet with the creator (2 hops)');
    } catch {
      failures++;
    }
  });
  if (candidates.length > 0 && failures === candidates.length) throw new Error('Could not trace funding of any early buyer');
  if (failures > 0) ctx.notes.push(`Funding could not be traced for ${failures} of ${candidates.length} early buyers.`);
  return [...linked.values()];
}
