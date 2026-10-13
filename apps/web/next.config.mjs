// Plain JavaScript on purpose: Next 15 loads next.config.ts through the TypeScript JS API, which TypeScript 7 doesn't ship.
import fs from 'node:fs';
import path from 'node:path';
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from 'next/constants.js';

/** Monorepo root (this app lives in apps/web). */
const root = path.resolve(process.cwd(), '../..');

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Content-Security-Policy. Everything the page needs comes from this origin: the browser never calls the database
 * or IPFS directly (logos go through /img). 'unsafe-inline' scripts are needed for Next's inline bootstrap.
 */
/** Wallet sign-in talks to WalletConnect/Reown relays, Coinbase Wallet and chain RPCs (only after "Sign in"). */
const WALLET_CONNECT = [
  'https://*.walletconnect.com',
  'wss://*.walletconnect.com',
  'https://*.walletconnect.org',
  'wss://*.walletconnect.org',
  'https://*.reown.com',
  'wss://*.reown.com',
  'https://*.coinbase.com',
  'wss://*.coinbase.com',
  'https://rpc.mainnet.chain.robinhood.com',
  'https://*.merkle.io',
  'https://*.base.org',
  'https://*.arbitrum.io',
].join(' ');
const WALLET_FRAMES = 'https://verify.walletconnect.com https://verify.walletconnect.org https://*.reown.com https://keys.coinbase.com';

const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.walletconnect.com https://*.reown.com",
  "font-src 'self' data:",
  `connect-src 'self' ${WALLET_CONNECT}${isDev ? ' ws: wss:' : ''}`,
  `frame-src ${WALLET_FRAMES}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: CSP },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
];

/** @param {string} phase @returns {Promise<import('next').NextConfig>} */
export default async function config(phase) {
  // Local dev / `next start`: read the monorepo's root .env. Never during a production build, so nothing secret
  // can end up in the deployed bundle. The website itself needs no secrets: it uses Cloudflare bindings (D1, rate limits).
  const rootEnv = path.join(root, '.env');
  if (phase !== PHASE_PRODUCTION_BUILD && fs.existsSync(rootEnv)) process.loadEnvFile(rootEnv);

  // `next dev`: give route handlers the wrangler.jsonc bindings (a local D1 copy).
  if (phase === PHASE_DEVELOPMENT_SERVER) {
    const { initOpenNextCloudflareForDev } = await import('@opennextjs/cloudflare');
    await initOpenNextCloudflareForDev();
  }

  return {
    // The engine and db packages are shipped as TypeScript source inside the monorepo.
    transpilePackages: ['@kestrion/engine', '@kestrion/db'],
    outputFileTracingRoot: root,
    poweredByHeader: false,
    // Types are checked by `npm run typecheck` (TypeScript 7), which Next 15's built-in check can't drive.
    typescript: { ignoreBuildErrors: true },
    eslint: { ignoreDuringBuilds: true },
    // Next 15 reads tsconfig "paths" through the TypeScript JS API (missing in TS 7), so set the "@/…" alias here.
    webpack(cfg) {
      cfg.resolve.alias = {
        ...cfg.resolve.alias,
        '@': path.join(process.cwd(), 'src'),
        // Optional peers of @coinbase/cdp-sdk (payments; pulled in by wagmi's Base Account connector, which we don't
        // use). Not installed, so resolve them to an empty module.
        '@x402/core': false,
        '@x402/evm': false,
        '@x402/extensions': false,
        '@x402/svm': false,
        // Optional modules of the MetaMask SDK (React Native storage) and WalletConnect's logger (pretty printing).
        '@react-native-async-storage/async-storage': false,
        'pino-pretty': false,
      };
      return cfg;
    },
    async headers() {
      return [{ source: '/:path*', headers: securityHeaders }];
    },
  };
}
