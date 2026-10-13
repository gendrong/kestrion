/**
 * Sign-in sessions. The browser keeps a random token in an HttpOnly cookie; the database keeps only its SHA-256 hash
 * (sessions table), so a database leak can't be used to sign in.
 */
import 'server-only';
import { getSessionUser, type Db, type User } from '@kestrion/db';
import { cookies } from 'next/headers';
import { getDb } from './db';

export const SESSION_COOKIE = 'kestrion_session';
const MAX_AGE_SECONDS = 30 * 86_400;

const toBase64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function newSessionToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function sessionCookie(token: string) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  };
}

/** The signed-in user of this request, or null. */
export async function currentUser(db: Db | null = getDb()): Promise<User | null> {
  if (!db) return null;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || token.length > 100) return null;
  return getSessionUser(db, await hashToken(token)).catch(() => null);
}

/**
 * Requests that change something must come from our own pages (the session cookie is SameSite=Lax; this also
 * rejects cross-site form posts and scripts).
 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}
