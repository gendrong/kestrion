/**
 * Minimal SQL client interface so the same repository code runs on:
 *  - the Worker's D1 binding (website),
 *  - the D1 HTTP API (GitHub Actions jobs),
 *  - node:sqlite (unit tests).
 */
export type SqlValue = string | number | null;

export interface Stmt {
  sql: string;
  params?: SqlValue[];
}

export interface SqlClient {
  /** Rows of one statement. */
  all<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  /** Execute one statement. */
  run(sql: string, params?: SqlValue[]): Promise<{ changes: number }>;
  /** Execute statements in order, in one transaction. Returns the rows of each statement. */
  batch(stmts: Stmt[]): Promise<Record<string, unknown>[][]>;
}

/** The parts of a Workers D1Database binding we use (typed here to avoid a workers-types dependency). */
export interface D1DatabaseLike {
  prepare(sql: string): {
    bind(...values: unknown[]): { all<T = unknown>(): Promise<{ results: T[] }>; run(): Promise<{ meta: { changes?: number } }> };
  };
  batch(stmts: unknown[]): Promise<{ results?: unknown[] }[]>;
}

/** Wrap a Worker D1 binding. */
export function fromD1Binding(db: D1DatabaseLike): SqlClient {
  const prep = (s: Stmt) => db.prepare(s.sql).bind(...(s.params ?? []));
  return {
    async all<T>(sql: string, params: SqlValue[] = []) {
      return (await prep({ sql, params }).all<T>()).results;
    },
    async run(sql: string, params: SqlValue[] = []) {
      return { changes: (await prep({ sql, params }).run()).meta.changes ?? 0 };
    },
    async batch(stmts: Stmt[]) {
      const res = await db.batch(stmts.map(prep));
      return res.map((r) => (r.results ?? []) as Record<string, unknown>[]);
    },
  };
}

export interface D1HttpConfig {
  accountId: string;
  databaseId: string;
  apiToken: string;
  /** Called with D1's per-statement usage (rows read / written), e.g. to track the free plan's daily quota. */
  onUsage?: (u: { rowsRead: number; rowsWritten: number }) => void;
}

export class D1HttpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'D1HttpError';
  }
}

/**
 * D1 over the Cloudflare REST API (for jobs running outside Cloudflare).
 * Source: https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/
 * Body: { sql, params } or { batch: [{ sql, params }] }; params must be strings (numbers are sent as strings).
 */
export function createD1HttpClient(cfg: D1HttpConfig): SqlClient {
  const url = `https://api.cloudflare.com/client/v4/accounts/${cfg.accountId}/d1/database/${cfg.databaseId}/query`;
  const toParams = (p: SqlValue[] = []) => p.map((v) => (v === null ? null : String(v)));

  async function post(body: unknown): Promise<{ results?: Record<string, unknown>[]; meta?: { changes?: number } }[]> {
    let last = '';
    for (let attempt = 0; attempt < 4; attempt++) {
      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${cfg.apiToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch (e) {
        last = `network error (${(e as Error).message})`;
        await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
        continue;
      }
      const json = (await res.json().catch(() => null)) as {
        success?: boolean;
        errors?: { message: string }[];
        result?: { results?: Record<string, unknown>[]; meta?: { changes?: number; rows_read?: number; rows_written?: number } }[];
      } | null;
      if (res.ok && json?.success) {
        if (cfg.onUsage) {
          for (const r of json.result ?? []) cfg.onUsage({ rowsRead: Number(r.meta?.rows_read ?? 0), rowsWritten: Number(r.meta?.rows_written ?? 0) });
        }
        return json.result ?? [];
      }
      last = `HTTP ${res.status}: ${json?.errors?.map((e) => e.message).join('; ') ?? 'no body'}`;
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
      break;
    }
    throw new D1HttpError(`D1 query failed: ${last}`);
  }

  return {
    async all<T>(sql: string, params?: SqlValue[]) {
      const r = await post({ sql, params: toParams(params) });
      return (r[0]?.results ?? []) as T[];
    },
    async run(sql: string, params?: SqlValue[]) {
      const r = await post({ sql, params: toParams(params) });
      return { changes: r[0]?.meta?.changes ?? 0 };
    },
    async batch(stmts: Stmt[]) {
      const r = await post({ batch: stmts.map((s) => ({ sql: s.sql, params: toParams(s.params) })) });
      return r.map((x) => x.results ?? []);
    },
  };
}
