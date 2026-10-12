import { describe, expect, it } from 'vitest';
import { getLogsChunked } from '../src/chain/logs';
import { A } from './fixtures';

type Params = { fromBlock: string; toBlock: string };

function fakeRpc(maxRange: number) {
  const calls: [number, number][] = [];
  return {
    calls,
    request: async ({ params }: { params: Params[] }) => {
      const from = parseInt(params[0]!.fromBlock, 16);
      const to = parseInt(params[0]!.toBlock, 16);
      calls.push([from, to]);
      if (to - from + 1 > maxRange) throw new Error('range too large');
      return [{ address: A(1), topics: [], data: '0x', blockNumber: `0x${from.toString(16)}`, transactionHash: `0x${'00'.repeat(32)}`, logIndex: '0x0' }];
    },
  };
}

describe('getLogsChunked', () => {
  it('splits a range into chunks', async () => {
    const rpc = fakeRpc(10_000);
    const logs = await getLogsChunked(rpc, { address: A(1), topics: [] }, 0n, 24_999n, { chunk: 10_000 });
    expect(rpc.calls).toEqual([
      [0, 9_999],
      [10_000, 19_999],
      [20_000, 24_999],
    ]);
    expect(logs.map((l) => l.blockNumber)).toEqual([0n, 10_000n, 20_000n]);
  });
  it('halves the chunk when the RPC rejects a range', async () => {
    const rpc = fakeRpc(2_500);
    const logs = await getLogsChunked(rpc, { address: A(1), topics: [] }, 0n, 9_999n, { chunk: 10_000 });
    // every block range is covered exactly once by the successful calls
    const ok = rpc.calls.filter(([f, t]) => t - f + 1 <= 2_500);
    expect(ok[0]![0]).toBe(0);
    expect(ok[ok.length - 1]![1]).toBe(9_999);
    expect(logs.length).toBe(ok.length);
  });
  it('gives up below the minimum chunk', async () => {
    const rpc = fakeRpc(10);
    await expect(getLogsChunked(rpc, { address: A(1), topics: [] }, 0n, 999n, { chunk: 1000, minChunk: 250 })).rejects.toThrow();
  });
});
