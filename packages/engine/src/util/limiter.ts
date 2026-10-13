export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Spaces out calls so we never exceed `perSecond` requests per second (shared by all callers). */
export class RateLimiter {
  private nextSlot = 0;
  private rate: number;

  constructor(
    private readonly perSecond: number,
    /** Lowest rate `slowDown()` may reach. */
    private readonly minPerSecond = Math.min(1, perSecond),
  ) {
    this.rate = perSecond;
  }

  /** Current requests per second (lower after the server pushed back). */
  get current() {
    return this.rate;
  }

  /** The server said "too many requests": halve the rate (down to the minimum) and pause briefly. */
  slowDown(pauseMs = 2000) {
    this.rate = Math.max(this.minPerSecond, this.rate / 2);
    this.nextSlot = Math.max(this.nextSlot, Date.now() + pauseMs);
  }

  /** A success: creep back up towards the configured rate. */
  recover() {
    if (this.rate < this.perSecond) this.rate = Math.min(this.perSecond, this.rate * 1.02);
  }

  async wait(): Promise<void> {
    const gap = 1000 / this.rate;
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
