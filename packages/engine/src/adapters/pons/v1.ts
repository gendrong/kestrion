/** Pons V1 (active + legacy factories): Uniswap v3 pools. Source: https://docs.ponsfamily.com */
import { decodeEventLog, pad, type Address, type Hex } from 'viem';
import { ponsV1FactoryAbi, uniswapV3PoolAbi } from '../../chain/abis';
import { BLOCKSCOUT, DEAD_ADDRESS, PONS_V1_ACTIVE, PONS_V1_LEGACY, PONS_V2, UNISWAP_V3, ZERO_ADDRESS } from '../../chain/config';
import { getLogsChunked } from '../../chain/logs';
import { TOPICS } from '../../chain/topics';
import type { EngineContext } from '../../context';
import type { CurveState, FactoryId, LaunchInfo, PriorLaunch, Trade } from '../../types';
import { pct, uniqAddrs } from '../../util/format';
import { mapLimit } from '../../util/limiter';
import type { DiscoveredLaunch, LaunchHint, PriorLaunchRef } from '../types';
import { contractLogs, isContract, locateLaunch, ranges, readPair, readTokenBasics } from './common';

export const V1_FACTORIES = [
  { id: 'pons-v1-active' as FactoryId, address: PONS_V1_ACTIVE.factory, startBlock: PONS_V1_ACTIVE.startBlock, closedAtBlock: PONS_V1_ACTIVE.closedAtBlock },
  { id: 'pons-v1-legacy' as FactoryId, address: PONS_V1_LEGACY.factory, startBlock: PONS_V1_LEGACY.startBlock, closedAtBlock: PONS_V1_LEGACY.closedAtBlock },
];

/** Last block that can contain launches: the closing block while launches stay disabled, else the chain head. */
async function searchEnd(ctx: EngineContext, f: (typeof V1_FACTORIES)[number], latestBlock: bigint): Promise<bigint> {
  try {
    const enabled = await ctx.rpc.readContract({ address: f.address, abi: ponsV1FactoryAbi, functionName: 'launchEnabled' });
    return enabled ? latestBlock : f.closedAtBlock;
  } catch {
    return latestBlock;
  }
}

const factoryOf = (id: FactoryId) => {
  const f = V1_FACTORIES.find((x) => x.id === id);
  if (!f) throw new Error(`Not a V1 factory: ${id}`);
  return f;
};

async function graduationStatus(ctx: EngineContext, factory: Address, token: Address) {
  const [pairedPrincipal, threshold, graduated] = await ctx.rpc.readContract({
    address: factory,
    abi: ponsV1FactoryAbi,
    functionName: 'graduationStatus',
    args: [token],
  });
  return { pairedPrincipal, threshold, graduated };
}

export async function findLaunchV1(ctx: EngineContext, token: Address, hint: LaunchHint = {}): Promise<LaunchInfo | null> {
  for (const f of V1_FACTORIES) {
    const lt = await ctx.rpc.readContract({ address: f.address, abi: ponsV1FactoryAbi, functionName: 'getLaunchedToken', args: [token] });
    const exists = lt[11];
    if (!exists) continue;

    const located = await locateLaunch(ctx, { factory: f.address, topic0: TOPICS.v1TokenLaunched, token, txHash: hint.txHash });
    const ev = decodeEventLog({ abi: ponsV1FactoryAbi, data: located.log.data, topics: located.log.topics as [Hex, ...Hex[]] });
    if (ev.eventName !== 'TokenLaunched') throw new Error('Unexpected launch event');
    const a = ev.args;
    const [basics, pair, deployerIsContract, grad] = await Promise.all([
      readTokenBasics(ctx, token),
      readPair(ctx, a.pairToken),
      isContract(ctx, a.deployer),
      graduationStatus(ctx, f.address, token),
    ]);
    return {
      launchpad: 'pons',
      factoryId: f.id,
      factoryAddress: f.address,
      version: 'v1',
      token,
      ...basics,
      deployer: a.deployer,
      deployerIsContract,
      launchTxFrom: located.from,
      launchTxTo: located.to,
      creator: deployerIsContract ? located.from : a.deployer,
      pairToken: a.pairToken,
      ...pair,
      pool: a.pool,
      launchBlock: located.blockNumber,
      launchTime: located.timestamp,
      launchTx: located.txHash,
      launchConfigId: a.launchConfigId,
      graduationThreshold: grad.threshold,
      restrictionsEndL1Block: a.restrictionsEndBlock,
      initialBuyAmount: a.initialBuyAmount,
      isToken0: lt[9],
    };
  }
  return null;
}

export async function readCurveStateV1(ctx: EngineContext, launch: LaunchInfo): Promise<CurveState> {
  const g = await graduationStatus(ctx, launch.factoryAddress, launch.token);
  return {
    raised: g.pairedPrincipal,
    threshold: g.threshold,
    progressPct: g.graduated ? 100 : Math.min(100, pct(g.pairedPrincipal, g.threshold)),
    graduated: g.graduated,
    phase: g.graduated ? 'Graduated' : 'NotGraduated',
  };
}

export async function getEarlyTradesV1(ctx: EngineContext, launch: LaunchInfo, blocks: number): Promise<Trade[]> {
  if (!launch.pool) return [];
  const logs = await contractLogs(ctx, launch.pool, [TOPICS.v3Swap], launch.launchBlock, launch.launchBlock + BigInt(blocks));
  const trades: Trade[] = [];
  for (const l of logs) {
    const ev = decodeEventLog({ abi: uniswapV3PoolAbi, data: l.data, topics: l.topics as [Hex, ...Hex[]] });
    if (ev.eventName !== 'Swap') continue;
    const tokenDelta = launch.isToken0 ? ev.args.amount0 : ev.args.amount1;
    const quoteDelta = launch.isToken0 ? ev.args.amount1 : ev.args.amount0;
    const base = { block: l.blockNumber, tx: l.transactionHash, logIndex: l.logIndex, time: l.timeStamp };
    // The creator's initial buy happens inside the launch tx and is routed through the factory.
    const inLaunchTx = l.transactionHash.toLowerCase() === launch.launchTx.toLowerCase();
    // Pool perspective: negative token delta = pool sent tokens out = a buy.
    if (tokenDelta < 0n)
      trades.push({ ...base, side: 'buy', wallet: inLaunchTx ? launch.creator : ev.args.recipient, tokenAmount: -tokenDelta, quoteAmount: quoteDelta });
    else trades.push({ ...base, side: 'sell', wallet: ev.args.sender, tokenAmount: tokenDelta, quoteAmount: -quoteDelta });
  }
  return trades;
}

export function holderExclusionsV1(launch: LaunchInfo): Address[] {
  return uniqAddrs([
    launch.pool,
    PONS_V1_ACTIVE.locker,
    PONS_V1_LEGACY.locker,
    UNISWAP_V3.positionManager,
    // V1 tokens can also have Uniswap v4 liquidity; the v4 PoolManager holds pool balances.
    PONS_V2.poolManager,
    launch.token,
    ZERO_ADDRESS,
    DEAD_ADDRESS,
  ]);
}

export async function discoverLaunchesV1(ctx: EngineContext, factoryId: FactoryId, fromBlock: bigint, toBlock: bigint): Promise<DiscoveredLaunch[]> {
  const f = factoryOf(factoryId);
  const logs = await getLogsChunked(ctx.rpc, { address: f.address, topics: [TOPICS.v1TokenLaunched] }, fromBlock, toBlock);
  return logs.map((l) => {
    const ev = decodeEventLog({ abi: ponsV1FactoryAbi, data: l.data, topics: l.topics as [Hex, ...Hex[]] });
    const a = ev.args as { token: Address; deployer: Address; pool: Address; pairToken: Address };
    return { factoryId, token: a.token, deployer: a.deployer, blockNumber: l.blockNumber, txHash: l.transactionHash, curveOrPool: a.pool, pairToken: a.pairToken };
  });
}

export async function findLaunchesByCreatorV1(
  ctx: EngineContext,
  creators: Address[],
  latestBlock: bigint,
): Promise<{ refs: PriorLaunchRef[]; partial: boolean }> {
  const explorer = ctx.explorer;
  if (!explorer) throw new Error('Explorer API needed to search launch history');
  const ends = await Promise.all(V1_FACTORIES.map((f) => searchEnd(ctx, f, latestBlock)));
  const jobs = V1_FACTORIES.flatMap((f, i) =>
    creators.flatMap((creator) =>
      ranges(f.startBlock, ends[i] as bigint, BigInt(BLOCKSCOUT.maxLogsApiRange)).map(([from, to]) => ({ f, creator, from, to })),
    ),
  );
  const results = await mapLimit(jobs, 4, async (j) => ({
    f: j.f,
    r: await explorer.logs({
      address: j.f.address,
      fromBlock: j.from,
      toBlock: j.to,
      topics: { 0: TOPICS.v1TokenLaunched, 2: pad(j.creator.toLowerCase() as Hex) },
    }),
  }));
  const refs: PriorLaunchRef[] = [];
  for (const { f, r } of results) {
    for (const l of r.logs) {
      const token = `0x${(l.topics[1] ?? '').slice(26)}` as Address;
      refs.push({ factoryId: f.id, token, launchBlock: l.blockNumber, launchTime: l.timeStamp });
    }
  }
  return { refs, partial: results.some((x) => x.r.capped) };
}

export async function describePriorLaunchV1(ctx: EngineContext, ref: PriorLaunchRef): Promise<PriorLaunch> {
  const f = factoryOf(ref.factoryId);
  const [basics, grad] = await Promise.all([
    readTokenBasics(ctx, ref.token).catch(() => ({ name: '?', symbol: '?' })),
    graduationStatus(ctx, f.address, ref.token).catch(() => null),
  ]);
  return {
    token: ref.token,
    factoryId: ref.factoryId,
    name: basics.name,
    symbol: basics.symbol,
    launchBlock: ref.launchBlock,
    launchTime: ref.launchTime,
    graduated: grad ? grad.graduated : null,
    // V1 "died fast" needs pool liquidity history; not computed (shown as unknown outcome).
    diedFast: null,
  };
}
