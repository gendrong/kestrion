/** Pons V2: per-token bonding curve → Uniswap v4. Source: https://docs.ponsfamily.com/v2 */
import { decodeEventLog, pad, type Address, type Hex } from 'viem';
import { ponsV2CurveAbi, ponsV2FactoryAbi } from '../../chain/abis';
import { AVG_BLOCK_TIME_SECONDS, BLOCKSCOUT, DEAD_ADDRESS, PONS_V2, RPC, V2_PHASES, ZERO_ADDRESS } from '../../chain/config';
import { getLogsChunked } from '../../chain/logs';
import { TOPICS } from '../../chain/topics';
import type { EngineContext } from '../../context';
import type { EngineConfig } from '../../scoring/config';
import type { CurveState, ExemptionData, LaunchInfo, PriorLaunch, Trade } from '../../types';
import { pct, sameAddr, uniqAddrs } from '../../util/format';
import { mapLimit } from '../../util/limiter';
import type { DiscoveredLaunch, PriorLaunchRef } from '../types';
import { decodeDeclaredExemptions, detectExemptBuys, diedFast, type CurveTradeLite } from './analysis';
import { contractLogs, isContract, locateLaunch, ranges, readPair, readTokenBasics } from './common';

type LaunchedTokenV2 = {
  token: Address;
  curve: Address;
  deployer: Address;
  creatorFeeRecipient: Address;
  pairToken: Address;
  graduationThreshold: bigint;
  phase: number;
  exists: boolean;
};

async function getLaunchedToken(ctx: EngineContext, token: Address): Promise<LaunchedTokenV2> {
  return (await ctx.rpc.readContract({
    address: PONS_V2.factory,
    abi: ponsV2FactoryAbi,
    functionName: 'getLaunchedToken',
    args: [token],
  })) as unknown as LaunchedTokenV2;
}

export async function findLaunchV2(ctx: EngineContext, token: Address): Promise<LaunchInfo | null> {
  const lt = await getLaunchedToken(ctx, token);
  if (!lt.exists) return null;

  const located = await locateLaunch(ctx, { factory: PONS_V2.factory, topic0: TOPICS.v2TokenLaunched, token });
  const ev = decodeEventLog({ abi: ponsV2FactoryAbi, data: located.log.data, topics: located.log.topics as [Hex, ...Hex[]] });
  if (ev.eventName !== 'TokenLaunched') throw new Error('Unexpected launch event');
  const args = ev.args as { curve: Address; deployer: Address; pairToken: Address; launchConfigId: bigint; graduationThreshold: bigint };

  const [basics, pair, deployerIsContract, feeBps, creatorTaxBps] = await Promise.all([
    readTokenBasics(ctx, token),
    readPair(ctx, args.pairToken),
    isContract(ctx, args.deployer),
    ctx.rpc.readContract({ address: args.curve, abi: ponsV2CurveAbi, functionName: 'feeBps' }),
    ctx.rpc.readContract({ address: args.curve, abi: ponsV2CurveAbi, functionName: 'creatorTaxBps' }),
  ]);

  return {
    launchpad: 'pons',
    factoryId: 'pons-v2',
    factoryAddress: PONS_V2.factory,
    version: 'v2',
    token,
    ...basics,
    deployer: args.deployer,
    deployerIsContract,
    launchTxFrom: located.from,
    launchTxTo: located.to,
    creatorFeeRecipient: lt.creatorFeeRecipient,
    // A third-party launcher contract can be the "deployer"; the person is the tx sender then.
    creator: deployerIsContract ? located.from : args.deployer,
    pairToken: args.pairToken,
    ...pair,
    curve: args.curve,
    launchBlock: located.blockNumber,
    launchTime: located.timestamp,
    launchTx: located.txHash,
    launchConfigId: args.launchConfigId,
    graduationThreshold: args.graduationThreshold,
    feeBps: Number(feeBps),
    creatorTaxBps: Number(creatorTaxBps),
  };
}

export async function readCurveStateV2(ctx: EngineContext, launch: LaunchInfo): Promise<CurveState> {
  const curve = launch.curve as Address;
  const [lt, raised, threshold] = await Promise.all([
    getLaunchedToken(ctx, launch.token),
    ctx.rpc.readContract({ address: curve, abi: ponsV2CurveAbi, functionName: 'realQuoteReserve' }),
    ctx.rpc.readContract({ address: curve, abi: ponsV2CurveAbi, functionName: 'graduationThreshold' }),
  ]);
  const phase = V2_PHASES[lt.phase] ?? `Phase ${lt.phase}`;
  const graduated = lt.phase === 1 || lt.phase === 2;
  return {
    raised,
    threshold,
    progressPct: graduated ? 100 : Math.min(100, pct(raised, threshold)),
    graduated,
    phase,
  };
}

function curveLogToTrade(log: { data: Hex; topics: Hex[]; blockNumber: bigint; transactionHash: Hex; logIndex: number; timeStamp?: number }): Trade | null {
  const ev = decodeEventLog({ abi: ponsV2CurveAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
  const base = { block: log.blockNumber, tx: log.transactionHash, logIndex: log.logIndex, time: log.timeStamp };
  if (ev.eventName === 'CurveBuy') {
    return { ...base, side: 'buy', wallet: ev.args.recipient, tokenAmount: ev.args.tokensOut, quoteAmount: ev.args.quoteIn, feeAmount: ev.args.fee };
  }
  if (ev.eventName === 'CurveSell') {
    return { ...base, side: 'sell', wallet: ev.args.seller, tokenAmount: ev.args.tokensIn, quoteAmount: ev.args.quoteOut, feeAmount: ev.args.fee };
  }
  return null;
}

export async function getEarlyTradesV2(ctx: EngineContext, launch: LaunchInfo, blocks: number): Promise<Trade[]> {
  const logs = await contractLogs(
    ctx,
    launch.curve as Address,
    [TOPICS.v2CurveBuy, TOPICS.v2CurveSell],
    launch.launchBlock,
    launch.launchBlock + BigInt(blocks),
  );
  return logs.map(curveLogToTrade).filter((t): t is Trade => t !== null);
}

export async function getExemptionsV2(
  ctx: EngineContext,
  launch: LaunchInfo,
  earlyTrades: Trade[],
  latestBlock: bigint,
): Promise<ExemptionData> {
  const windowSeconds = Number(
    await ctx.rpc.readContract({ address: PONS_V2.factory, abi: ponsV2FactoryAbi, functionName: 'snipeTaxSeconds' }),
  );
  const tx = await ctx.rpc.getTransaction({ hash: launch.launchTx });
  const declared = decodeDeclaredExemptions(tx.input, tx.to ?? null);
  // Docs v2: the launcher and the creator fee recipient are exempt automatically. The official router
  // buys on the creator's behalf in launchAndBuy, so it is exempt too.
  const autoExempt = uniqAddrs([launch.deployer, launch.creatorFeeRecipient, launch.launchTxFrom, PONS_V2.launchAndBuyRouter]);
  const isAuto = (a: Address) => autoExempt.some((x) => sameAddr(x, a));

  const detected: { address: Address; via: string }[] = [];
  const add = (address: Address, via: string) => {
    if (isAuto(address) || detected.some((d) => sameAddr(d.address, address))) return;
    detected.push({ address, via });
  };
  const taxFree = new Set(
    detectExemptBuys(earlyTrades, launch.launchTime, windowSeconds, launch.feeBps ?? 100).map((a) => a.toLowerCase()),
  );

  // Primary source: the curve emits SnipeTaxExempted(account) for every exempt wallet when it is created
  // (same block as the launch). Complete and permanent, also for launches made through other contracts.
  let onChain: Address[] | null = null;
  try {
    const logs = await contractLogs(ctx, launch.curve as Address, [TOPICS.v2SnipeTaxExempted], launch.launchBlock, launch.launchBlock);
    onChain = logs.map((l) => {
      const ev = decodeEventLog({ abi: ponsV2CurveAbi, data: l.data, topics: l.topics as [Hex, ...Hex[]] });
      return (ev.args as { account: Address }).account;
    });
  } catch {
    onChain = null;
  }
  if (onChain) {
    for (const a of onChain) {
      add(a, taxFree.has(a.toLowerCase()) ? `exempt at launch; bought in the first ${windowSeconds}s tax-free` : 'exempt at launch (SnipeTaxExempted event)');
    }
    return { windowSeconds, declared, detected, autoExempt, complete: true };
  }

  // Fallbacks when the event logs can't be read.
  // Evidence 1: bought inside the snipe-tax window without paying the snipe tax.
  for (const a of taxFree) add(a as Address, `bought in the first ${windowSeconds}s without paying the snipe tax`);

  // Evidence 2: snipe-tax rate for the wallet was 0% at the launch block (needs historical state).
  // Skipped when the launch tx already gave us the complete list.
  if (declared === null && latestBlock - launch.launchBlock <= BigInt(RPC.historicalStateBlocks)) {
    const candidates = uniqAddrs(earlyTrades.filter((t) => t.side === 'buy').map((t) => t.wallet))
      .filter((a) => !isAuto(a) && !detected.some((d) => sameAddr(d.address, a)))
      .slice(0, 30);
    const rates = await mapLimit(candidates, 4, (a) =>
      ctx.rpc
        .readContract({
          address: launch.curve as Address,
          abi: ponsV2CurveAbi,
          functionName: 'currentSnipeTaxBps',
          args: [a],
          blockNumber: launch.launchBlock,
        })
        .catch(() => null), // historical state not available
    );
    candidates.forEach((a, i) => {
      if (rates[i] === 0n) add(a, 'snipe-tax rate was 0% at the launch block');
    });
  }

  if (declared) for (const a of declared) add(a, 'listed as exempt in the launch transaction');
  return { windowSeconds, declared, detected, autoExempt, complete: declared !== null };
}

export function holderExclusionsV2(launch: LaunchInfo): Address[] {
  return uniqAddrs([
    launch.curve,
    PONS_V2.poolManager,
    PONS_V2.launchLocker,
    PONS_V2.buybackVault,
    PONS_V2.feeEscrow,
    PONS_V2.memeHook,
    launch.token,
    ZERO_ADDRESS,
    DEAD_ADDRESS,
  ]);
}

export async function discoverLaunchesV2(ctx: EngineContext, fromBlock: bigint, toBlock: bigint): Promise<DiscoveredLaunch[]> {
  const logs = await getLogsChunked(ctx.rpc, { address: PONS_V2.factory, topics: [TOPICS.v2TokenLaunched] }, fromBlock, toBlock);
  return logs.map((l) => {
    const ev = decodeEventLog({ abi: ponsV2FactoryAbi, data: l.data, topics: l.topics as [Hex, ...Hex[]] });
    const a = ev.args as { token: Address; deployer: Address };
    return { factoryId: 'pons-v2', token: a.token, deployer: a.deployer, blockNumber: l.blockNumber, txHash: l.transactionHash };
  });
}

export async function findLaunchesByCreatorV2(
  ctx: EngineContext,
  creators: Address[],
  latestBlock: bigint,
): Promise<{ refs: PriorLaunchRef[]; partial: boolean }> {
  const explorer = ctx.explorer;
  if (!explorer) throw new Error('Explorer API needed to search launch history');
  const jobs = creators.flatMap((creator) =>
    ranges(PONS_V2.deployBlock, latestBlock, BigInt(BLOCKSCOUT.maxLogsApiRange)).map(([from, to]) => ({ creator, from, to })),
  );
  const results = await mapLimit(jobs, 4, (j) =>
    explorer.logs({
      address: PONS_V2.factory,
      fromBlock: j.from,
      toBlock: j.to,
      topics: { 0: TOPICS.v2TokenLaunched, 3: pad(j.creator.toLowerCase() as Hex) },
    }),
  );
  const refs: PriorLaunchRef[] = [];
  for (const r of results) {
    for (const l of r.logs) {
      const ev = decodeEventLog({ abi: ponsV2FactoryAbi, data: l.data, topics: l.topics as [Hex, ...Hex[]] });
      const a = ev.args as { token: Address; curve: Address; graduationThreshold: bigint };
      refs.push({ factoryId: 'pons-v2', token: a.token, curve: a.curve, graduationThreshold: a.graduationThreshold, launchBlock: l.blockNumber, launchTime: l.timeStamp });
    }
  }
  return { refs, partial: results.some((r) => r.capped) };
}

export async function describePriorLaunchV2(ctx: EngineContext, ref: PriorLaunchRef, cfg: EngineConfig, now: number): Promise<PriorLaunch> {
  const [basics, lt] = await Promise.all([readTokenBasics(ctx, ref.token).catch(() => ({ name: '?', symbol: '?' })), getLaunchedToken(ctx, ref.token)]);
  const graduated = lt.phase === 1 || lt.phase === 2;
  let died: boolean | null = null;
  const d = cfg.checks.creatorHistory.diedFast;
  if (ctx.explorer && ref.curve && ref.launchTime !== undefined) {
    const windowBlocks = BigInt(Math.ceil((d.windowHours * 3600 * 1.1) / AVG_BLOCK_TIME_SECONDS));
    const [buys, sells] = await Promise.all([
      ctx.explorer.logs({ address: ref.curve, fromBlock: ref.launchBlock, toBlock: ref.launchBlock + windowBlocks, topics: { 0: TOPICS.v2CurveBuy } }),
      ctx.explorer.logs({ address: ref.curve, fromBlock: ref.launchBlock, toBlock: ref.launchBlock + windowBlocks, topics: { 0: TOPICS.v2CurveSell } }),
    ]);
    if (!buys.capped && !sells.capped) {
      const trades: CurveTradeLite[] = [...buys.logs, ...sells.logs]
        .map(curveLogToTrade)
        .filter((t): t is Trade => t !== null && t.time !== undefined)
        .map((t) => ({ time: t.time as number, side: t.side, quoteAmount: t.quoteAmount }));
      died = diedFast(trades, {
        launchTime: ref.launchTime,
        threshold: ref.graduationThreshold ?? lt.graduationThreshold,
        graduated,
        now,
        windowHours: d.windowHours,
        dropPct: d.dropPct,
        minPeakPctOfThreshold: d.minPeakPctOfThreshold,
      });
    }
  }
  return {
    token: ref.token,
    factoryId: 'pons-v2',
    name: basics.name,
    symbol: basics.symbol,
    launchBlock: ref.launchBlock,
    launchTime: ref.launchTime,
    graduated,
    diedFast: died,
  };
}
