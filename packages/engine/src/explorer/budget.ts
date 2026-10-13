/**
 * Explorer credit budget. The free Blockscout tier gives 100k credits per day (most calls cost 20, so ~5,000 calls),
 * reset at 00:00 UTC. Source: https://docs.blockscout.com/devs/plans-and-credits (checked 2026-10-13).
 * Every response carries `x-credits-remaining`; we keep the latest value here (shared by all scans of a job run)
 * so quick scans of every launch keep working all day and full scans only use what is left over.
 */
export const CREDITS = {
  perDay: 100_000,
  /** Default cost of one call. */
  perCall: 20,
  /** Below this, no explorer calls at all (checks that need them become unknown). */
  floor: 1_000,
  /** Credits a quick scan of one launch may use (~2–3 calls: creator wallet + funder). */
  perQuickScan: 60,
  /** Expected Pons launches per hour (~1,300 a day, measured 2026-10-12/13). */
  launchesPerHour: 55,
  /** Extra kept back for on-demand work (wallet lookups, people opening reports). */
  reserve: 5_000,
} as const;

export class CreditBudget {
  /** Latest `x-credits-remaining`, or null before the first answer. */
  remaining: number | null = null;
  exhausted = false;

  constructor(private readonly now: () => number = Date.now) {}

  /** Record a response's credit header (and a 402 "Out of credits"). */
  observe(status: number, header: string | null) {
    if (status === 402) {
      this.exhausted = true;
      this.remaining = 0;
      return;
    }
    const n = header !== null ? Number(header) : Number.NaN;
    if (Number.isFinite(n)) {
      this.remaining = n;
      this.exhausted = n < CREDITS.floor;
    }
  }

  /** May any explorer call be made? */
  canCall(): boolean {
    return !this.exhausted;
  }

  /** Credits quick scans need until the daily reset (00:00 UTC). */
  reservedForQuickScans(): number {
    const d = new Date(this.now());
    const hoursLeft = 24 - d.getUTCHours() - d.getUTCMinutes() / 60;
    return Math.ceil(hoursLeft * CREDITS.launchesPerHour * CREDITS.perQuickScan) + CREDITS.reserve;
  }

  /** May a full scan (funding traces, many more calls) run now without starving the rest of the day's quick scans? */
  allowFullScan(): boolean {
    if (this.exhausted) return false;
    if (this.remaining === null) return true; // unknown yet: the first call will tell
    return this.remaining > this.reservedForQuickScans();
  }
}
