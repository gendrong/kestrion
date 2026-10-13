# $KEST launch day: turning on the Holder tier (Phase 7)

Everything is built and switched off. Until both values below are set, everyone is on the Free tier.

## What the owner sends
1. The $KEST **contract address** (CA).
2. The **Holder threshold**: how many whole $KEST a wallet needs (e.g. `100000`).
3. Optional: a different Holder API limit (default 3,000 requests/min per key; Free keys: 600).

## What Claude does
1. **Verify the address** on https://robin.etherscan.io (and Blockscout): it is a token contract, name/symbol are
   KEST, it was launched by the owner's wallet (launch tx). Never use an address that can't be verified.
2. Set it in `packages/engine/src/chain/config.ts` → `KEST.address`, with a comment citing the launch tx.
3. Set `HOLDER_MIN_KEST` in `packages/db/src/tiers.ts` (and the Holder limits there if they change; the Holder API
   limit must match `HOLDER_KEY_LIMITER` in `apps/web/wrangler.jsonc`).
4. `npm run typecheck && npm test`, then `npm run deploy` and push (the jobs pick the change up on their next run).
5. Test: a wallet holding at least the threshold signs in → the account menu shows "Holder account", the watchlist
   allows more than 5 tokens, its API keys answer with `X-RateLimit-Limit: 3000`. A wallet below the threshold stays Free.

## How it works
- Sign-in reads the wallet's `balanceOf` and `decimals()` on-chain (read-only) and sets the tier.
- The ingest job re-reads balances of recently active accounts once an hour (`jobs/src/tiers.ts`), so a wallet that
  sells drops back to Free. Items above the Free limits are kept, but no new ones can be added.
- Kestrion scans $KEST like every other launch: no special treatment in the score.
