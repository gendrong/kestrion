/**
 * Collects all data a scan needs. Each piece is loaded independently: if one source fails, that piece
 * becomes an error Result and the checks that need it return `unknown` (never a silent pass).
 */
import type { Address } from 'viem';
import type { LaunchpadAdapter } from '../adapters/types';
import { DEAD_ADDRESS, ZERO_ADDRESS } from '../chain/config';
import type { EngineContext } from '../context';
import type { EngineConfig } from '../scoring/config';
import { err, ok, type Holder, type LaunchInfo, type Result, type ScanData, type WalletFlow } from '../types';
import { sameAddr, uniqAddrs } from '../util/format';
import { mapLimit } from '../util/limiter';
import { buildCreatorProfile, computeLinkedWallets, creatorIdentities, WalletProfiler } from './wallets';

export class NotALaunchError extends Error {
  constructor(token: string) {
    super(`${token} was not launched by a supported launchpad (checked Pons V2, V1 active, V1 legacy).`);
    this.name = 'NotALaunchError';
  }
}

async function attempt<T>(ctx: EngineContext, label: string, fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return ok(await fn());
  } catch (e) {
    const msg = (e as Error).message?.split('\n')[0] ?? String(e);
    ctx.notes.push(`${label}: ${msg}`);
    return err(msg);
  }
}

export async function collectScanData(
  ctx: EngineContext,
  adapter: LaunchpadAdapter,
  token: Address,
  cfg: EngineConfig,
): Promise<ScanData> {
  ctx.log('Finding launch…');
  const launch = await adapter.findLaunch(token);
  if (!launch) throw new NotALaunchError(token);
  const latestBlock = await ctx.rpc.getBlockNumber();
  const now = Math.floor(Date.now() / 1000);
  const profiler = new WalletProfiler(ctx, now);

  // Creator history only needs the launch info and its log searches are slow, so start it right away.
  const priorLaunchesP = attempt(ctx, 'Creator history', () => loadPriorLaunches(ctx, adapter, launch, cfg, now));

  ctx.log('Reading curve, early trades, holders and creator wallet…');
  const [curve, earlyTrades, holders, creatorWallet] = await Promise.all([
    attempt(ctx, 'Curve state', () => adapter.readCurveState(launch)),
    attempt(ctx, 'Early trades', () => adapter.getEarlyTrades(launch, cfg.earlyWindowBlocks)),
    attempt(ctx, 'Holders', () => loadHolders(ctx, launch)),
    attempt(ctx, 'Creator wallet', () => buildCreatorProfile(profiler, launch.creator)),
  ]);

  ctx.log('Checking snipe-tax exemptions…');
  const exemptions = await (async () => {
    if (!earlyTrades.ok) return err<never>(`needs early trades (${earlyTrades.error})`);
    try {
      const r = await adapter.getExemptions(launch, earlyTrades.value, latestBlock);
      return r === 'not_applicable' ? r : ok(r);
    } catch (e) {
      const msg = (e as Error).message.split('\n')[0] ?? 'failed';
      ctx.notes.push(`Snipe-tax exemptions: ${msg}`);
      return err<never>(msg);
    }
  })();

  ctx.log('Tracing wallet funding…');
  const linked = await attempt(ctx, 'Linked wallets', () =>
    computeLinkedWallets(ctx, profiler, launch, earlyTrades, exemptions, creatorWallet, cfg),
  );

  ctx.log('Reading token flows of creator and linked wallets…');
  const flowWallets = linked.ok
    ? linked.value.map((w) => w.address)
    : creatorIdentities(launch).map((i) => i.address);
  const flows = await attempt(ctx, 'Token flows', () => loadFlows(ctx, launch.token, flowWallets.slice(0, cfg.maxFlowWallets)));

  ctx.log('Finishing creator history…');
  const priorLaunches = await priorLaunchesP;

  return {
    launch,
    now,
    latestBlock,
    earlyWindowBlocks: cfg.earlyWindowBlocks,
    curve,
    earlyTrades,
    exemptions,
    holders,
    excluded: adapter.holderExclusions(launch),
    creatorWallet,
    linked,
    priorLaunches,
    flows,
  };
}

async function loadHolders(ctx: EngineContext, launch: LaunchInfo): Promise<Holder[]> {
  if (!ctx.explorer) throw new Error('Explorer API needed for holder list');
  return ctx.explorer.tokenHolders(launch.token);
}

async function loadPriorLaunches(ctx: EngineContext, adapter: LaunchpadAdapter, launch: LaunchInfo, cfg: EngineConfig, now: number) {
  // Search by EOA identities only: a third-party launcher contract would match everyone's launches.
  const creators = uniqAddrs([launch.creator, launch.deployerIsContract ? undefined : launch.deployer]);
  const { refs, partial } = await adapter.findLaunchesByCreator(creators);
  const seen = new Set<string>();
  const others = refs
    .filter((r) => !sameAddr(r.token, launch.token))
    .filter((r) => (seen.has(r.token.toLowerCase()) ? false : (seen.add(r.token.toLowerCase()), true)))
    .sort((a, b) => (a.launchBlock > b.launchBlock ? -1 : 1));
  const analysed = await mapLimit(others.slice(0, cfg.maxPriorLaunchesAnalyzed), 2, (r) => adapter.describePriorLaunch(r, cfg, now));
  return { launches: analysed, total: others.length, partial: partial || launch.deployerIsContract };
}

async function loadFlows(ctx: EngineContext, token: Address, wallets: Address[]): Promise<WalletFlow[]> {
  const explorer = ctx.explorer;
  if (!explorer) throw new Error('Explorer API needed for token flows');
  const group = new Set(wallets.map((w) => w.toLowerCase()));
  const inGroup = (a: string) => group.has(a.toLowerCase());
  const lockerCache = new Map<string, Promise<boolean>>();
  const isLockOrBurn = (a: Address) => {
    if (sameAddr(a, ZERO_ADDRESS) || sameAddr(a, DEAD_ADDRESS)) return Promise.resolve(true);
    const k = a.toLowerCase();
    let p = lockerCache.get(k);
    if (!p) {
      p = explorer.addressInfo(a).then((i) => isLockerInfo(i.isContract, i.labels)).catch(() => false);
      lockerCache.set(k, p);
    }
    return p;
  };
  return mapLimit(wallets, 3, async (w) => {
    const { transfers, capped } = await explorer.tokenTransfers(w, token);
    if (capped) ctx.notes.push(`Token flows of ${w} were capped at 1000 transfers.`);
    let received = 0n;
    const outByRecipient = new Map<string, { to: Address; value: bigint }>();
    for (const t of transfers) {
      // Transfers between the creator's own wallets are neither buying nor selling.
      if (sameAddr(t.to, w) && !inGroup(t.from)) received += t.value;
      if (sameAddr(t.from, w) && !inGroup(t.to)) {
        const k = t.to.toLowerCase();
        const cur = outByRecipient.get(k) ?? { to: t.to, value: 0n };
        cur.value += t.value;
        outByRecipient.set(k, cur);
      }
    }
    let sent = 0n;
    let lockedOrBurned = 0n;
    // Check the biggest recipients for lockers/burn (the rest count as sent).
    const outs = [...outByRecipient.values()].sort((a, b) => (a.value > b.value ? -1 : 1));
    for (const [i, o] of outs.entries()) {
      if (i < 5 && (await isLockOrBurn(o.to))) lockedOrBurned += o.value;
      else sent += o.value;
    }
    return { address: w, received, sent, lockedOrBurned };
  });
}

/** A token locker: a contract whose public name/labels mention "lock" (e.g. "RobinhoodLocker"). */
export const isLockerInfo = (isContract: boolean, labels: (string | undefined)[]) =>
  isContract && labels.some((l) => !!l && /lock/i.test(l));
