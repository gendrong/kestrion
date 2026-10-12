/** Event topic0 hashes computed from the event signatures (a test checks them against VERIFIED_TOPICS). */
import { toEventSelector } from 'viem';

export const TOPICS = {
  v1TokenLaunched: toEventSelector(
    'TokenLaunched(address,address,address,address,address,uint256,uint256,uint256,uint256,uint256)',
  ),
  v2TokenLaunched: toEventSelector('TokenLaunched(address,address,address,address,uint256,uint256)'),
  v2CurveBuy: toEventSelector('CurveBuy(address,address,uint256,uint256,uint256,uint256)'),
  v2CurveSell: toEventSelector('CurveSell(address,address,uint256,uint256,uint256,uint256)'),
  v2SnipeTaxExempted: toEventSelector('SnipeTaxExempted(address)'),
  v2PoolGraduated: toEventSelector('PoolGraduated(address,uint256,uint256,uint256)'),
  v3Swap: toEventSelector('Swap(address,address,int256,int256,uint160,uint128,int24)'),
} as const;
