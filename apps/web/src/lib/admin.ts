/** /admin access: only wallets listed in ADMIN_WALLETS (wrangler.jsonc "vars"). */
import 'server-only';
import type { User } from '@kestrion/db';
import { cfEnv } from './cloudflare';

export function adminWallets(): string[] {
  return (cfEnv().ADMIN_WALLETS ?? process.env.ADMIN_WALLETS ?? '')
    .split(',')
    .map((a) => a.trim().toLowerCase())
    .filter((a) => /^0x[0-9a-f]{40}$/.test(a));
}

export const isAdmin = (user: User | null): boolean => !!user && adminWallets().includes(user.wallet.toLowerCase());
