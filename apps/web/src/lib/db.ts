import 'server-only';
import { fromD1Binding, type Db } from '@kestrion/db';
import { cfEnv } from './cloudflare';

/** The D1 database (binding "DB"), or null when it isn't available (not on Workers / not configured). */
export function getDb(): Db | null {
  const binding = cfEnv().DB;
  return binding ? fromD1Binding(binding) : null;
}
