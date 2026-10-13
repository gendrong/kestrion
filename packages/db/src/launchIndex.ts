/** Our index of every Pons launch (from the factories' events), so creator history needs no explorer searches. */
import type { Db } from './repo';

const lc = (a: string) => a.toLowerCase();

export interface IndexedLaunch {
  token: string;
  factory: string;
  deployer: string;
  curveOrPool: string | null;
  pairToken: string | null;
  graduationThreshold: string | null;
  launchBlock: number;
  launchTime: string | null;
  txHash: string;
}

/** D1 allows at most 100 bound parameters per statement: 11 rows × 9 columns. */
const ROWS_PER_STATEMENT = 11;

/** Add launches (already indexed tokens are left as they are). Returns how many rows were sent. */
export async function insertLaunches(db: Db, launches: IndexedLaunch[]): Promise<number> {
  if (launches.length === 0) return 0;
  const stmts = [];
  for (let i = 0; i < launches.length; i += ROWS_PER_STATEMENT) {
    const chunk = launches.slice(i, i + ROWS_PER_STATEMENT);
    stmts.push({
      sql: `INSERT OR IGNORE INTO launch_index
              (token, factory, deployer, curve_or_pool, pair_token, graduation_threshold, launch_block, launch_time, tx_hash)
            VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
      params: chunk.flatMap((l) => [
        lc(l.token),
        l.factory,
        lc(l.deployer),
        l.curveOrPool ? lc(l.curveOrPool) : null,
        l.pairToken ? lc(l.pairToken) : null,
        l.graduationThreshold,
        l.launchBlock,
        l.launchTime,
        l.txHash,
      ]),
    });
  }
  // Big backfills go in several requests (one D1 batch per 40 statements ≈ 440 rows).
  for (let i = 0; i < stmts.length; i += 40) await db.batch(stmts.slice(i, i + 40));
  return launches.length;
}

const toLaunch = (r: Record<string, unknown>): IndexedLaunch => ({
  token: r.token as string,
  factory: r.factory as string,
  deployer: r.deployer as string,
  curveOrPool: (r.curve_or_pool as string | null) ?? null,
  pairToken: (r.pair_token as string | null) ?? null,
  graduationThreshold: (r.graduation_threshold as string | null) ?? null,
  launchBlock: Number(r.launch_block),
  launchTime: (r.launch_time as string | null) ?? null,
  txHash: r.tx_hash as string,
});

/** Launches by these deployers, newest first. */
export async function launchesByDeployers(db: Db, deployers: string[], limit = 500): Promise<IndexedLaunch[]> {
  const list = [...new Set(deployers.map(lc))].slice(0, 20);
  if (list.length === 0) return [];
  const rows = await db.all(
    `SELECT * FROM launch_index WHERE deployer IN (${list.map(() => '?').join(', ')})
      ORDER BY launch_block DESC LIMIT ${Math.max(1, Math.min(2000, Math.floor(limit)))}`,
    list,
  );
  return rows.map(toLaunch);
}

export async function getIndexedLaunch(db: Db, token: string): Promise<IndexedLaunch | null> {
  const r = (await db.all(`SELECT * FROM launch_index WHERE token = ? LIMIT 1`, [lc(token)]))[0];
  return r ? toLaunch(r) : null;
}
