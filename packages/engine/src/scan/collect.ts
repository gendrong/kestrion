/**
 * Collects all data a scan needs. Each piece is loaded independently: if one source fails, that piece
 * becomes an error Result and the checks that need it return `unknown` (never a silent pass).
 *
 * Two depths (the explorer's free tier allows ~5,000 calls a day, Pons has ~1,300 launches a day):
 * - quick: everything the RPC can give (free) + the creator wallet's history (~2 explorer calls). Funding traces of
 *   early buyers are skipped (linked wallets = the creator's own identities), prior launches get no "died fast".
 * - full: also traces early buyers' funding (≤ 2 hops) and the outcome of the creator's recent launches.
 */
import type { Address } from 'viem';
import { isContract } from '../adapters/pons/common';
import type { LaunchHint, LaunchIndex, LaunchpadAdapter } from '../adapters/types';
import { DEAD_ADDRESS, ZERO_ADDRESS } from '../chain/config';
import type { EngineContext } from '../context';
import type { EngineConfig } from '../scoring/config';
import {
  err,
  ok,
  type CreatorProfile,
  type Holder,
  type LaunchInfo,
  type Result,
  type ScanData,
  type ScanDepth,
  type WalletFlow,
} from '../types';
import { sameAddr, uniqAddrs } from '../util/format';
import { mapLimit } from '../util/limiter';
import { ledgerHolders, ledgerTransfersOf, readLedger, type TransferLedger } from './ledger';
import { buildCreatorProfile, computeLinkedWallets, creatorIdentities, WalletProfiler } from './wallets';

export class NotALaunchError extends Error {
  constructor(token: string) {
    super(`${token} was not launched by a supported launchpad (checked Pons V2, V1 active, V1 legacy).`);
    this.name = 'NotALaunchError';
  }
}

/** Why linked wallets are missing in a quick scan (shown as the unknown reason). */
export const QUICK_SCAN_NO_TRACE = 'early buyers’ funding is traced in a full scan (it runs when a token gains traction or someone opens its report)';

export interface CollectOptions {
  depth?: ScanDepth;
  hint?: LaunchHint;
  /** Our own launch index: creator history without explorer searches. */
  launchIndex?: LaunchIndex;
  /** A stored profile of the creator wallet (saves its explorer calls). */
  knownCreator?: (address: Address) => Promise<CreatorProfile | null>;
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
  opts: CollectOptions = {},
): Promise<ScanData> {
  const full = (opts.depth ?? 'full') === 'full';
  ctx.log('Finding launch…');
  const launch = await adapter.findLaunch(token, opts.hint);
  if (!launch) throw new NotALaunchError(token);
  const latestBlock = await ctx.rpc.getBlockNumber();
  const now = Math.floor(Date.now() / 1000);
  const profiler = new WalletProfiler(ctx, now);

  // Creator history only needs the launch info and its searches can be slow, so start it right away.
  const priorLaunchesP = attempt(ctx, 'Creator history', () =>
    loadPriorLaunches(ctx, adapter, launch, cfg, now, { index: opts.launchIndex, outcomes: full }),
  );
  // All transfers of the token from the RPC (young tokens): holders and flows without explorer calls.
  const ledgerP = readLedger(ctx, launch.token, launch.launchBlock, latestBlock).catch(() => null);

  ctx.log('Reading curve, early trades, holders and creator wallet…');
  const [curve, earlyTrades, holders, creatorWallet] = await Promise.all([
    attempt(ctx, 'Curve state', () => adapter.readCurveState(launch)),
    attempt(ctx, 'Early trades', () => adapter.getEarlyTrades(launch, cfg.earlyWindowBlocks)),
    attempt(ctx, 'Holders', async () => loadHolders(ctx, launch, await ledgerP, adapter.holderExclusions(launch))),
    attempt(ctx, 'Creator wallet', async () => {
      const known = await opts.knownCreator?.(launch.creator).catch(() => null);
      return known ?? buildCreatorProfile(profiler, launch.creator, full);
    }),
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

  let linked: ScanData['linked'];
  if (full) {
    ctx.log('Tracing wallet funding…');
    linked = await attempt(ctx, 'Linked wallets', () =>
      computeLinkedWallets(ctx, profiler, launch, earlyTrades, exemptions, creatorWallet, cfg),
    );
  } else {
    linked = err(QUICK_SCAN_NO_TRACE);
  }

  ctx.log('Reading token flows of creator and linked wallets…');
  const flowWallets = linked.ok ? linked.value.map((w) => w.address) : creatorIdentities(launch).map((i) => i.address);
  const ledger = await ledgerP;
  const flows = await attempt(ctx, 'Token flows', () => loadFlows(ctx, launch.token, flowWallets.slice(0, cfg.maxFlowWallets), ledger));

  ctx.log('Finishing creator history…');
  const priorLaunches = await priorLaunchesP;

  return {
    launch,
    now,
    latestBlock,
    earlyWindowBlocks: cfg.earlyWindowBlocks,
    depth: full ? 'full' : 'quick',
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

/** Contract holders whose names we look up (to recognise lockers) when holders come from the RPC. */
const MAX_HOLDER_NAME_LOOKUPS = 3;

async function loadHolders(ctx: EngineContext, launch: LaunchInfo, ledger: TransferLedger | null, excluded: Address[]): Promise<Holder[]> {
  if (!ledger) {
    if (!ctx.explorer) throw new Error('Explorer API needed for holder list');
    return ctx.explorer.tokenHolders(launch.token);
  }
  const skip = new Set(excluded.map((a) => a.toLowerCase()));
  // The report lists the top 10 real holders; 20 leaves room for the curve, pool and burn addresses it skips.
  const top = ledgerHolders(ledger).slice(0, 20);
  let lookups = 0;
  return mapLimit(top, 6, async (h) => {
    const contract = await isContract(ctx, h.address).catch(() => false);
    let name: string | undefined;
    if (contract && !skip.has(h.address.toLowerCase()) && ctx.explorer && lookups < MAX_HOLDER_NAME_LOOKUPS) {
      lookups++;
      name = await ctx.explorer
        .addressInfo(h.address)
        .then((i) => i.name ?? i.labels[0])
        .catch(() => undefined);
    }
    return { address: h.address, balance: h.balance, isContract: contract, name };
  });
}

async function loadPriorLaunches(
  ctx: EngineContext,
  adapter: LaunchpadAdapter,
  launch: LaunchInfo,
  cfg: EngineConfig,
  now: number,
  opts: { index?: LaunchIndex; outcomes: boolean },
) {
  // Search by EOA identities only: a third-party launcher contract would match everyone's launches.
  const creators = uniqAddrs([launch.creator, launch.deployerIsContract ? undefined : launch.deployer]);
  let found: Awaited<ReturnType<LaunchpadAdapter['findLaunchesByCreator']>>;
  if (opts.index) {
    const r = await opts.index.byDeployers(creators);
    found = { refs: r.refs, partial: !r.complete };
  } else {
    found = await adapter.findLaunchesByCreator(creators);
  }
  const seen = new Set<string>();
  const others = found.refs
    .filter((r) => !sameAddr(r.token, launch.token))
    .filter((r) => (seen.has(r.token.toLowerCase()) ? false : (seen.add(r.token.toLowerCase()), true)))
    .sort((a, b) => (a.launchBlock > b.launchBlock ? -1 : 1));
  const analysed = await mapLimit(others.slice(0, cfg.maxPriorLaunchesAnalyzed), 2, (r) =>
    adapter.describePriorLaunch(r, cfg, now, { outcome: opts.outcomes }),
  );
  const all = others.map((r) => ({ token: r.token, factoryId: r.factoryId, launchBlock: r.launchBlock, launchTime: r.launchTime }));
  return { launches: analysed, total: others.length, partial: found.partial || launch.deployerIsContract, all };
}

async function loadFlows(ctx: EngineContext, token: Address, wallets: Address[], ledger: TransferLedger | null): Promise<WalletFlow[]> {
  const explorer = ctx.explorer;
  if (!ledger && !explorer) throw new Error('Explorer API needed for token flows');
  const group = new Set(wallets.map((w) => w.toLowerCase()));
  const inGroup = (a: string) => group.has(a.toLowerCase());
  const lockerCache = new Map<string, Promise<boolean>>();
  const isLockOrBurn = (a: Address) => {
    if (sameAddr(a, ZERO_ADDRESS) || sameAddr(a, DEAD_ADDRESS)) return Promise.resolve(true);
    const k = a.toLowerCase();
    let p = lockerCache.get(k);
    if (!p) {
      p = (async () => {
        // Only contracts can be lockers; check the RPC first so wallets cost no explorer call.
        if (!(await isContract(ctx, a).catch(() => true))) return false;
        if (!explorer) return false;
        const i = await explorer.addressInfo(a);
        return isLockerInfo(i.isContract, i.labels);
      })().catch(() => false);
      lockerCache.set(k, p);
    }
    return p;
  };
  return mapLimit(wallets, 3, async (w) => {
    let transfers: { from: Address; to: Address; value: bigint }[];
    if (ledger) {
      transfers = ledgerTransfersOf(ledger, w);
    } else {
      const r = await explorer!.tokenTransfers(w, token);
      if (r.capped) ctx.notes.push(`Token flows of ${w} were capped at 1000 transfers.`);
      transfers = r.transfers;
    }
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
