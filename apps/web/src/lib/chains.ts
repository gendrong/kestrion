/** Robinhood Chain for the wallet libraries (browser-safe: no engine runtime). Facts from CLAUDE.md §2 / chain config. */
import { defineChain } from 'viem';
import { RPC } from '@kestrion/engine/config';

export const robinhoodChain = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC.publicUrl] } },
  blockExplorers: { default: { name: 'RobinScan', url: 'https://robin.etherscan.io' } },
});
