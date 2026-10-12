/** Pons adapter: one entry point for the three independent Pons factories (V2, V1 active, V1 legacy). */
import type { Address } from 'viem';
import { PONS_V1_ACTIVE, PONS_V1_LEGACY, PONS_V2 } from '../../chain/config';
import type { EngineContext } from '../../context';
import type { EngineConfig } from '../../scoring/config';
import type { CurveState, ExemptionData, FactoryId, LaunchInfo, PriorLaunch, Trade } from '../../types';
import type { TokenMetadata } from '../../util/media';
import type { DiscoveredLaunch, FactoryInfo, LaunchpadAdapter, PriorLaunchRef } from '../types';
import { readTokenMetadata } from './metadata';
import {
  describePriorLaunchV1,
  discoverLaunchesV1,
  findLaunchV1,
  findLaunchesByCreatorV1,
  getEarlyTradesV1,
  holderExclusionsV1,
  readCurveStateV1,
} from './v1';
import {
  describePriorLaunchV2,
  discoverLaunchesV2,
  findLaunchV2,
  findLaunchesByCreatorV2,
  getEarlyTradesV2,
  getExemptionsV2,
  holderExclusionsV2,
  readCurveStateV2,
} from './v2';

export class PonsAdapter implements LaunchpadAdapter {
  readonly id = 'pons';
  readonly factories: FactoryInfo[] = [
    { id: 'pons-v2', address: PONS_V2.factory, startBlock: PONS_V2.deployBlock, version: 'v2' },
    { id: 'pons-v1-active', address: PONS_V1_ACTIVE.factory, startBlock: PONS_V1_ACTIVE.startBlock, version: 'v1' },
    { id: 'pons-v1-legacy', address: PONS_V1_LEGACY.factory, startBlock: PONS_V1_LEGACY.startBlock, version: 'v1' },
  ];

  constructor(private readonly ctx: EngineContext) {}

  async findLaunch(token: Address): Promise<LaunchInfo | null> {
    return (await findLaunchV2(this.ctx, token)) ?? (await findLaunchV1(this.ctx, token));
  }

  discoverLaunches(factoryId: FactoryId, fromBlock: bigint, toBlock: bigint): Promise<DiscoveredLaunch[]> {
    return factoryId === 'pons-v2'
      ? discoverLaunchesV2(this.ctx, fromBlock, toBlock)
      : discoverLaunchesV1(this.ctx, factoryId, fromBlock, toBlock);
  }

  readCurveState(launch: LaunchInfo): Promise<CurveState> {
    return launch.version === 'v2' ? readCurveStateV2(this.ctx, launch) : readCurveStateV1(this.ctx, launch);
  }

  getEarlyTrades(launch: LaunchInfo, blocks: number): Promise<Trade[]> {
    return launch.version === 'v2' ? getEarlyTradesV2(this.ctx, launch, blocks) : getEarlyTradesV1(this.ctx, launch, blocks);
  }

  async getExemptions(launch: LaunchInfo, earlyTrades: Trade[], latestBlock: bigint): Promise<ExemptionData | 'not_applicable'> {
    // V1 has no snipe-tax exemption list (it uses a 2-block launch protection instead).
    return launch.version === 'v2' ? getExemptionsV2(this.ctx, launch, earlyTrades, latestBlock) : 'not_applicable';
  }

  holderExclusions(launch: LaunchInfo): Address[] {
    return launch.version === 'v2' ? holderExclusionsV2(launch) : holderExclusionsV1(launch);
  }

  async findLaunchesByCreator(creators: Address[]): Promise<{ refs: PriorLaunchRef[]; partial: boolean }> {
    const latest = await this.ctx.rpc.getBlockNumber();
    const [v2, v1] = await Promise.all([
      findLaunchesByCreatorV2(this.ctx, creators, latest),
      findLaunchesByCreatorV1(this.ctx, creators, latest),
    ]);
    return { refs: [...v2.refs, ...v1.refs], partial: v2.partial || v1.partial };
  }

  describePriorLaunch(ref: PriorLaunchRef, cfg: EngineConfig, now: number): Promise<PriorLaunch> {
    return ref.factoryId === 'pons-v2' ? describePriorLaunchV2(this.ctx, ref, cfg, now) : describePriorLaunchV1(this.ctx, ref);
  }

  readTokenMetadata(launch: LaunchInfo): Promise<TokenMetadata> {
    return readTokenMetadata(this.ctx, launch);
  }
}
