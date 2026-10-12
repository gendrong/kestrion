export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Spaces out calls so we never exceed `perSecond` requests per second (shared by all callers). */
export class RateLimiter {
  private nextSlot = 0;

  constructor(private readonly perSecond: number) {}

  async wait(): Promise<void> {
    const gap = 1000 / this.perSecond;
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot);
    this.nextSlot = slot + gap;
    if (slot > now) await sleep(slot - now);
  }
}

/** Run `fn` over `items` with at most `concurrency` in flight; keeps input order. */
export async function mapLimit<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  });
  await Promise.all(workers);
  return out;
}
