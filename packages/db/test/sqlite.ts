/** In-memory SQLite SqlClient for tests (node:sqlite), with the real migration applied. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import type { SqlClient, SqlValue, Stmt } from '../src/sql';

const here = path.dirname(fileURLToPath(import.meta.url));

export function testDb(): SqlClient {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const f of fs.readdirSync(path.join(here, '../migrations')).sort()) {
    db.exec(fs.readFileSync(path.join(here, '../migrations', f), 'utf8'));
  }
  const exec = (s: Stmt) => db.prepare(s.sql).all(...((s.params ?? []) as SqlValue[])) as Record<string, unknown>[];
  return {
    async all<T>(sql: string, params: SqlValue[] = []) {
      return exec({ sql, params }) as T[];
    },
    async run(sql: string, params: SqlValue[] = []) {
      const r = db.prepare(sql).run(...params);
      return { changes: Number(r.changes) };
    },
    async batch(stmts: Stmt[]) {
      db.exec('BEGIN');
      try {
        const out = stmts.map(exec);
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}
