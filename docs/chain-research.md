# Phase 1a — Chain research (Robinhood Chain · Pons)

Researched 2026-10-08. Everything marked **✅ on-chain** was checked live against the RPC
(chainId 4663, block ~83.1M) with throwaway viem scripts. Nothing here is guessed;
anything not verified is marked **UNVERIFIED**.

---

## 0. Headline findings (read these first)

1. **Pons now runs on "Pons V2", which is a different system from what `CLAUDE.md` §2 describes.**
   - §2 describes **V1**: Uniswap v3 pools, an "active" + "legacy" factory.
   - **V2** (factory `0x7eD5…EC7e`, deployed 2026-08-03) uses a **bonding curve per token**, then
     graduates into a **Uniswap v4** pool. It has its own `TokenLaunched` event with a different signature.
   - In the last 200,000 blocks (~5.7 h) there were **320 launches on V2** and **0 on either V1 factory**.
   - The **snipe tax + up to 32 exempt wallets** feature (check #1) exists **only in V2**.
2. **The public RPC only keeps ~5,000–7,000 blocks of state (~10 min).** Historical `eth_call` older than
   that fails. Logs (`eth_getLogs`) are available for all history, max **20,000 blocks per call**.
3. **Blocks are ~0.103 s** (≈ 10 per second). 20,000 blocks ≈ 34 min. A 5-minute ingest ≈ 3,000 blocks.
4. **V1 `restrictionsEndBlock` is an Ethereum L1 block number**, not a Robinhood Chain block number
   (on Arbitrum chains `block.number` returns the L1 block). Don't compare it to L2 blocks.
5. **Wallet history (age, funding source, 2-hop trace) is NOT available from the RPC.** It needs an
   explorer API → **Blockscout PRO API, free key** (see §5).
6. **Your internet provider blocks the RPC host.** Your default DNS resolves
   `rpc.mainnet.chain.robinhood.com` to `198.54.100.22` (serves a Starlink certificate); public DNS
   (1.1.1.1 / 8.8.8.8) resolves it correctly to Offchain Labs / Cloudflare. Vercel / GitHub Actions are
   not affected. For local development you'll need to change DNS (see §7).

---

## 1. Network

| Item | Value | Source | Status |
|---|---|---|---|
| Chain ID | `4663` | docs.ponsfamily.com; RPC `eth_chainId` → `0x1237` | ✅ on-chain |
| Public RPC | `https://rpc.mainnet.chain.robinhood.com` | https://docs.ponsfamily.com | ✅ `eth_chainId`=4663, `eth_blockNumber`=83,135,470 |
| RPC log range limit | 20,000 blocks per `eth_getLogs` | tested (50,000 rejected) | ✅ |
| RPC state history | ~5,000 blocks OK, 7,000+ fails | tested `eth_call` at latest−N | ✅ |
| Block time | ~0.1029 s | 100,000 blocks = 10,286 s | ✅ |
| Explorer (Etherscan) | https://robin.etherscan.io | CLAUDE.md §3; Etherscan chainlist API | ✅ |
| Explorer (Blockscout) | https://robinhoodchain.blockscout.com | https://docs.ponsfamily.com | listed |
| **Fallback RPC** | `https://api.blockscout.com/4663/json-rpc?apikey=…` (free key) | https://docs.blockscout.com/robinhood-api.md | ✅ `eth_blockNumber`, `eth_call`, `eth_getLogs` work |

## 2. Pons V2 (current: where launches happen now)

Source for addresses: https://docs.ponsfamily.com/v2 (Pons v2 Technical Reference). All have bytecode ✅ on-chain.

| Contract | Address | Notes |
|---|---|---|
| **V2 Factory** (`PonsV2LaunchFactory`) | `0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e` | Verified on robin.etherscan.io. Created block **26,841,846** (2026-08-03 14:41 UTC), tx `0x3817f297…deddeb` ✅ |
| Meme Hook (Uniswap v4 hook) | `0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044` | `poolManager()` ✅ |
| **Uniswap v4 PoolManager** | `0x8366a39CC670B4001A1121B8F6A443A643e40951` | from `factory.poolManager()` and `hook.poolManager()` ✅ |
| Fee Escrow | `0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e` | |
| Buyback Vault | `0x42df2a798f82289E177311362e8f5ccC45c1219c` | holds locked buyback tokens (5-yr vest) → exclude from holders |
| Launch Locker | `0x267444D099b10fB5Ed7c3Cc7B7c767AdcA574952` | permanent LP lock → exclude from holders |
| Launch and Buy router | `0xe33E9E479dF8802cb0866d5d05258bEc4cF62948` | `launchAndBuy(...)` |
| Launch Deployer | `0x3711ceA4feaDE896C913C68F01Eda97Cb06D1A42` | |
| Graduation Executor | `0xC7819B64A1dAECD7eC19856d026cb14EfBd89046` | |
| Graduation Guard | `0xf5695117b99B6f6401e67d4195BD653628176C6C` | |

### V2 events

| Event | Signature | topic0 | Status |
|---|---|---|---|
| TokenLaunched (factory) | `TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)` | `0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607` | ✅ 320 logs decoded |
| CurveBuy (per-token curve) | `CurveBuy(address indexed buyer, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 tax)` | `0xec36bf571f136799e8dc0b0b8bea4b04d8bd3d43de838aab0d5fc21d4cbfc455` | ✅ decoded |
| CurveSell, CurveCompleted, PoolGraduated, LaunchSwept, … | see docs v2 | — | from docs, not yet decoded |

⚠️ The robin.etherscan.io page summary showed a *different* `TokenLaunched` (4 params). That did **not**
match chain data; the docs signature above is the one that matches all 320 real logs.

### V2 functions (✅ = called on-chain and decoded)

- ✅ `factory.getLaunchedToken(address)` → tuple
  `(address token, address curve, address deployer, address creatorFeeRecipient, address pairToken, uint256 graduationThreshold, uint24 poolFee, int24 tickSpacing, uint16 creatorTaxBps, bool buybackEnabled, uint8 phase, uint256 sweptQuote, uint256 sweptTokens, uint256 sweptAt, bool exists)`
  — `phase`: 0 NotGraduated · 1 Swept · 2 PoolCreated · 3 Rescued (docs v2)
- ✅ `factory.snipeTaxSeconds()` = **3** · ✅ `factory.snipeTaxStartBps()` = **9900** (99%) · ✅ `factory.launchEnabled()` = true
  (docs say "decays to zero across ~5 s" — the live setting is 3 s)
- ✅ `launchToken(TokenParams, uint256 launchConfigId, address pairToken, address[] snipeTaxExemptions)` selector `0xa72101af`
- ✅ `launchToken(TokenParams, uint256, address)` selector `0xf35abbcf`
- ✅ `launchAndBuy(TokenParams, uint256, address, uint256 quoteIn, uint256 minTokensOut, address recipient, address[] snipeTaxExemptions)` selector `0xf85f8e41`
- ✅ Curve: `graduationThreshold()`, `realQuoteReserve()`, `sellableTokens()`, `reservedTokens()`, `readyToGraduate()`, `graduated()`, `pairToken()`, `isNativeQuote()`, `feeBps()` (=100), `creatorTaxBps()`, `currentSnipeTaxBps(address)`
- From docs only: `getReserves()`, `tokenReserve()`, token `getTokenInfo()`, hook `launches(poolId)`

`TokenParams` = `(string name, string symbol, string logo, string description, (string twitter, string telegram, string discord, string website, string farcaster) socials, address creatorFeeRecipient, uint16 creatorTaxBps, bool buybackEnabled, bytes32 expectedEconomics, bytes32 salt)` — source: robin.etherscan.io verified ABI; ✅ decodes real launch tx.

### V2 facts observed on-chain
- Supply 1e27 (1 billion × 1e18). Curve sells 714,285,714 tokens; 285,714,285 reserved for the pool ✅
- ETH-paired launches use `pairToken = 0x000…000` (native ETH), threshold **4.2 ETH** ✅
- Non-ETH pairs exist, e.g. `ORBIO` `0xAa07A0e9209e16aC99708C3EC70159c6eF3128A3` (a memecoin), threshold in that token's units ✅
- **Launches via third-party contracts exist**: e.g. tx `0x8fd4…384c` was sent to `0x0E1651aEC67B2a049a4FA6aEb6C1c305aabfc35b`,
  and the event's `deployer` = that contract, not the person. Real creator = `tx.from` and/or `creatorFeeRecipient`. ✅

## 3. Pons V1 (older launches: still tradable, no new launches seen recently)

Source: https://docs.ponsfamily.com and https://docs.mobula.io/almanac/robinhood-launchpads/pons. All bytecode ✅.

| Contract | Address | Start block (docs) |
|---|---|---|
| V1 "active" factory | `0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB` | 8,991,118 |
| V1 legacy factory | `0x0c37a24F5D23A486FA692d1500881d698B1F77a4` | 8,600,612 |
| V1 active locker | `0x736D76699C26D0d966744cAe304C000d471f7F35` | |
| V1 legacy locker | `0x31ca5E101941A93A7DD6d0497928700625CF54B5` | |
| Uniswap v3 factory | `0x1f7d7550B1b028f7571E69A784071F0205FD2EfA` | ✅ matches `dexFactory` in a real V1 event |
| Uniswap v3 position manager | `0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3` | ✅ returned by `getLaunchedToken` |
| Swap router | `0xCaf681a66D020601342297493863E78C959E5cb2` | |
| QuoterV2 | `0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7` | |
| WETH | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` | ✅ name/symbol WETH |

- ✅ **Event** `TokenLaunched(address indexed token, address indexed deployer, address indexed dexFactory, address pairToken, address pool, uint256 dexId, uint256 launchConfigId, uint256 positionId, uint256 restrictionsEndBlock, uint256 initialBuyAmount)`
  topic0 `0xdb51ea9ad51ab453a65a4cb7e60c3cb378c9501bb002609f8f97778fb6c4235a` (matches docs; decoded a real log from the active factory at block 9,019,252)
- ✅ `getLaunchedToken(address)` → `(address token, address deployer, address pairedToken, address positionManager, uint256 positionId, uint256 dexId, uint256 launchConfigId, uint256 restrictionsEndBlock, uint256 supply, bool isToken0, uint24 poolFee, bool exists, uint256 initialBuyAmount)` (tested with PONS on legacy factory)
- ✅ `graduationStatus(address)` → `(uint256 pairedPrincipal, uint256 threshold, bool graduated)`; threshold 4.2 ETH
- ✅ Token: `liquidityPool()`, `socials()` → `(twitter, telegram, discord, website, farcaster)`
- V1 launch protection (docs): first 2 blocks, only creator's buy on the launch block, then max 5% hold / 5.5% buy.
  **No snipe-tax whitelist in V1.** `restrictionsEndBlock` is an **L1 block number** (finding #4).

## 4. Pair tokens

| Pair | Address | Status |
|---|---|---|
| ETH (V2 native) | `0x0000000000000000000000000000000000000000` | ✅ |
| WETH (V1) | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` | ✅ |
| USDG ("Global Dollar", 6 decimals) | `0x5fc5360d0400a0fd4f2af552add042d716f1d168` | ✅ name/symbol on-chain; found via dexpaprika pool pages. Paxos docs page could not be loaded from this machine. |
| USDG OFT wrapper (NOT the token) | `0x0d54755f5106BfdB43f7a35f5D49a23F940628d1` | not an ERC-20 (calls fail) |
| Stock Tokens | — | **UNVERIFIED: no official list found** |
| Other approved tokens (e.g. ORBIO memecoin) | per launch | ✅ exists |

## 5. Data gaps: can we compute each check? (CLAUDE.md §7)

| # | Check | Available? | How / alternative |
|---|---|---|---|
| 1 | Snipe-tax exemptions + creator funding (2 hops) | **V2: yes, partly**. V1: not applicable | (a) decode `snipeTaxExemptions` from launch tx input when sent to the factory or router ✅; (b) **`CurveBuy` logs in the first 3 s**: a buy whose `tax` ≈ only the creator tax (not 99%) came from an exempt wallet; works forever ✅; (c) `currentSnipeTaxBps(addr)` at the launch block returns **0 for exempt** vs 9900 (✅ tested), but only within ~10 min of launch (state window). Exempt wallets that never bought and were launched via a 3rd-party contract can't be listed (no trace API) → report "≥ N exempt". Funding trace needs **explorer API**. V1 has no exemption list → show V1 launch-protection info instead. |
| 2 | Creator cluster buy | **Yes** (buys); linking needs explorer API | V2: `CurveBuy` logs in the first N blocks. V1: Uniswap v3 `Swap` logs. "Linked wallets" (shared funder) need wallet history → explorer API. |
| 3 | Holder concentration | **Yes** | Rebuild balances from `Transfer` logs (fine for young tokens), or Blockscout token-holders endpoint. Exclude: V2 curve, v4 PoolManager, Launch Locker, Buyback Vault, V1 pool + V1 lockers, `0x0`, `0x…dEaD`. |
| 4 | Creator history | **Yes, after a one-time backfill** | Index all `TokenLaunched` since V2 deploy block 26,841,846 (~2,800 log calls of 20k blocks) + V1 ranges. "Died fast" from curve reserves over time (CurveBuy/CurveSell) or v4 swaps. Creator identity = `tx.from` / `creatorFeeRecipient` when `deployer` is a contract. |
| 5 | Creator wallet age + funding source | **No via RPC** | Needs explorer API (first tx, first funder). RPC only gives the nonce. |
| 6 | Curve state | **Yes** ✅ | V2: `realQuoteReserve / graduationThreshold`, `phase`, `graduated()`. V1: `graduationStatus()`. |
| 7 | Pair type | **Yes**, list incomplete | ETH / USDG verified. Stock Token list UNVERIFIED. Add an "Other token" category (e.g. ORBIO). |
| 8 | Sell pressure | **Yes** (more work after graduation) | V2: `CurveSell` logs + `Transfer`; after graduation: v4 PoolManager `Swap` events by poolId. V1: v3 pool `Swap`. Linked wallets need explorer API. |

**Blockscout PRO API key obtained and tested ✅** (stored as `BLOCKSCOUT_API_KEY` in `.env`, git-ignored).
Base `https://api.blockscout.com/4663/api/v2`, `?apikey=…`. Verified working:
`/addresses/{a}/transactions` (incl. sender + value → funding source), `/addresses/{a}/counters`,
`/addresses/{a}/internal-transactions`, `/tokens/{t}`, `/tokens/{t}/holders` (matches on-chain `balanceOf` and
`Transfer` logs), and the JSON-RPC fallback. Note: on a V2 token, the curve contract holds all unsold supply.

**Explorer API recommendation:** Blockscout PRO API: free key at https://dev.blockscout.com,
5 req/s, 100K credits/day; endpoints for address transactions, internal txs (limited to 1,000 records
on this chain), token holders, ABIs. Base `https://api.blockscout.com`, chain 4663.
Source: https://docs.blockscout.com/robinhood-api.md. Etherscan API V2 also lists chain 4663
(`https://api.etherscan.io/v2/api?chainid=4663`, key required; whether the free tier covers it is UNVERIFIED).
The public Blockscout site API is behind a Cloudflare challenge (HTTP 403 for scripts).

## 6. UNVERIFIED / not used

- `0xf4fc0cd27fc8ecf17e55ee4c3f7201897df3eb75` (130-byte contract) emitted a V1-format `TokenLaunched`, and
  `0x2d040d7b41feaa0e758e72da6f57d710f15ab0a1` emitted a V2-format one. **Not Pons.** → ingest must filter by
  factory address, never by event signature alone.
- `0x0E1651aEC67B2a049a4FA6aEb6C1c305aabfc35b`: third-party launcher contract (unknown owner).
- `https://github.com/pons-labs` has **no public repositories**.
- https://ponsfamily.com/builders has no technical data (just the PONS token address).

## 6b. Added during Phase 1b (all ✅ verified on-chain)

- **Verified ABIs via Blockscout PRO** (`/api/v2/smart-contracts/{address}`): V2 factory (`PonsV2LaunchFactory`),
  router (`PonsV2LaunchAndBuy`) and V1 factory (`PonsLaunchFactory`) are verified. The V2 **curve is not verified**,
  but Blockscout decodes its events.
- **Docs v2 abbreviate some event signatures.** Real ones (verified ABI):
  - `PoolGraduated(address indexed token, uint256 positionId, uint256 tokenAmount, uint256 pairTokenAmount)` topic0 `0x0a44ef75…c259` (3,710 graduations so far)
  - `LaunchSwept(address indexed token, uint256 quoteOut, uint256 tokenOut)`
  - `CreatorFeeRecipientUpdated(address indexed token, address indexed previousRecipient, address indexed newRecipient)`
- **`SnipeTaxExempted(address indexed account)`**, topic0 `0xe4b7e48f…a8c7`, is emitted by the curve in the launch block
  for every exempt wallet (including the automatic ones). This is the complete, permanent exemption list, also for
  launches made through third-party contracts. Cross-checked: 17 events = 17 addresses decoded from the launch tx.
- **`CurveSell(address indexed seller, address indexed recipient, uint256 tokensIn, uint256 quoteOut, uint256 fee, uint256 tax)`**
  topic0 `0x8113d738…59df`: docs signature confirmed by Blockscout decoding.
- **Snipe tax mechanics (measured with `currentSnipeTaxBps` at historical blocks):** per second of block time,
  +0 s 9900 bps → +1 s 618 bps → +2 s 19 bps → +3 s 0. The snipe tax is **included in the CurveBuy `fee` field**
  (e.g. 1% base + 6.18% = 7.18%); the `tax` field is only the creator tax. An exempt wallet pays exactly the base fee.
- **Blockscout JSON-RPC:** historical `eth_call` works ~50,000 blocks back (≈ 85 min); `eth_getLogs` accepts 10,000 blocks.
  Occasional HTTP 503 → retry.
- **Blockscout logs API** (`/4663/api?module=logs&action=getLogs`): topic filters over ≤ 10M blocks per call (30M times out),
  max 1,000 results, includes timestamps. Used for creator history and early trades.
- **Contract creation tx** of a token (`/api/v2/addresses/{token}` → `creation_transaction_hash`) = its launch tx.

## 6c. Added during Phase 3 (✅ verified on-chain)

- **Both V1 factories are closed:** `launchEnabled()` = false. `LaunchEnabledUpdated(false)` at block **34,788,845**
  (V1 active) and **34,788,864** (V1 legacy). V2 `launchEnabled()` = true.
- **V2 token metadata:** `getTokenInfo()` → `(address deployer, string logo, string description, (string twitter, string telegram,
  string discord, string website, string farcaster) socials)` works (docs v2 signature confirmed).
- **Logos are untrusted strings:** seen `ipfs://<cid>`, `https://ipfs.io/ipfs/<cid>` and `http://<raw IP>/uploads_images/…png`.
  Kestrion only shows IPFS images, fetched through its own proxy; anything else falls back to initials.

## 7. Local development note (DNS)

Your ISP's DNS returns the wrong IP for `rpc.mainnet.chain.robinhood.com`. Before Phase 1b, set Windows DNS
to `1.1.1.1` / `8.8.8.8` (Settings → Network → your connection → DNS server assignment → Manual), or the
engine will need a fallback RPC. Production (Vercel / GitHub Actions) is not affected.

Later the same day, connections to the public RPC from this machine also failed with `CERT_HAS_EXPIRED`
even via 1.1.1.1 (network interception again). The Blockscout JSON-RPC fallback worked. So the engine
should try the public RPC first and switch to the fallback automatically.
