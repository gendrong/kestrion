/**
 * Every on-chain address, event topic and chain constant the engine uses.
 * Each value cites where it came from. Full verification notes: docs/chain-research.md
 * NEVER add an address here without a source.
 */
import type { Address } from 'viem';

/** Robinhood Chain. Source: docs.ponsfamily.com; verified `eth_chainId` = 0x1237 (4663). */
export const CHAIN_ID = 4663;

/** Measured on-chain: 100,000 blocks = 10,286 s (chain-research §1). */
export const AVG_BLOCK_TIME_SECONDS = 0.1029;

export const RPC = {
  /** Public RPC. Source: https://docs.ponsfamily.com. Verified eth_chainId / eth_blockNumber. */
  publicUrl: 'https://rpc.mainnet.chain.robinhood.com',
  /** Blockscout PRO JSON-RPC (free key). Source: https://docs.blockscout.com/robinhood-api.md. Verified. */
  blockscoutUrl: (apiKey: string) => `https://api.blockscout.com/4663/json-rpc?apikey=${apiKey}`,
  /** Largest eth_getLogs range both RPCs accept (public: 20k, Blockscout: 10k verified). */
  maxLogRange: 10_000,
  /** Blockscout RPC answered historical eth_call 50k blocks back (public RPC: only ~5k). Margin kept. */
  historicalStateBlocks: 45_000,
} as const;

export const BLOCKSCOUT = {
  /** Source: https://docs.blockscout.com/robinhood-api.md */
  base: 'https://api.blockscout.com/4663',
  /** Free tier: 5 requests/second. We stay a bit below. */
  requestsPerSecond: 4.5,
  /** Etherscan-style getLogs with topic filters answered 10M-block ranges; 30M timed out (tested). */
  maxLogsApiRange: 10_000_000,
  /** Etherscan-style endpoints return at most this many records per call. */
  maxRecords: 1000,
} as const;

export const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';
export const DEAD_ADDRESS: Address = '0x000000000000000000000000000000000000dEaD';

/**
 * Pons V2 — the system where new launches happen (bonding curve → Uniswap v4).
 * Source: https://docs.ponsfamily.com/v2 ("Pons v2 Technical Reference"). All have bytecode on-chain.
 */
export const PONS_V2 = {
  /** PonsV2LaunchFactory — verified on robin.etherscan.io. Created tx 0x3817f297…deddeb. */
  factory: '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e' as Address,
  /** Factory creation block (2026-08-03 14:41 UTC), from the creation receipt. */
  deployBlock: 26_841_846n,
  launchAndBuyRouter: '0xe33E9E479dF8802cb0866d5d05258bEc4cF62948' as Address,
  memeHook: '0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044' as Address,
  /** Uniswap v4 PoolManager — returned by factory.poolManager() and hook.poolManager(). */
  poolManager: '0x8366a39CC670B4001A1121B8F6A443A643e40951' as Address,
  feeEscrow: '0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e' as Address,
  buybackVault: '0x42df2a798f82289E177311362e8f5ccC45c1219c' as Address,
  launchLocker: '0x267444D099b10fB5Ed7c3Cc7B7c767AdcA574952' as Address,
  launchDeployer: '0x3711ceA4feaDE896C913C68F01Eda97Cb06D1A42' as Address,
  graduationExecutor: '0xC7819B64A1dAECD7eC19856d026cb14EfBd89046' as Address,
  graduationGuard: '0xf5695117b99B6f6401e67d4195BD653628176C6C' as Address,
} as const;

/** Pons V1 (Uniswap v3). Source: https://docs.ponsfamily.com + Mobula almanac. Bytecode verified. */
export const PONS_V1_ACTIVE = {
  factory: '0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB' as Address,
  locker: '0x736D76699C26D0d966744cAe304C000d471f7F35' as Address,
  startBlock: 8_991_118n,
  /** LaunchEnabledUpdated(false) at this block; launchEnabled() = false (verified 2026-10-08). */
  closedAtBlock: 34_788_845n,
} as const;

export const PONS_V1_LEGACY = {
  factory: '0x0c37a24F5D23A486FA692d1500881d698B1F77a4' as Address,
  locker: '0x31ca5E101941A93A7DD6d0497928700625CF54B5' as Address,
  startBlock: 8_600_612n,
  /** LaunchEnabledUpdated(false) at this block; launchEnabled() = false (verified 2026-10-08). */
  closedAtBlock: 34_788_864n,
} as const;

/** Uniswap v3 deployment used by Pons V1. Source: docs.ponsfamily.com; factory matched a real V1 event. */
export const UNISWAP_V3 = {
  factory: '0x1f7d7550B1b028f7571E69A784071F0205FD2EfA' as Address,
  positionManager: '0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3' as Address,
} as const;

export const TOKENS = {
  /** WETH. Source: docs.ponsfamily.com; on-chain name/symbol = WETH. */
  WETH: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73' as Address,
  /** USDG "Global Dollar" (6 decimals). Verified on-chain name/symbol; found via dexpaprika pools. */
  USDG: '0x5fc5360d0400a0fd4f2af552add042d716f1d168' as Address,
} as const;

/**
 * Event topic0 hashes, verified against real logs (chain-research §2, §3).
 * The engine computes them from the ABIs; a unit test checks they still equal these values.
 */
export const VERIFIED_TOPICS = {
  v1TokenLaunched: '0xdb51ea9ad51ab453a65a4cb7e60c3cb378c9501bb002609f8f97778fb6c4235a',
  v2TokenLaunched: '0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607',
  v2CurveBuy: '0xec36bf571f136799e8dc0b0b8bea4b04d8bd3d43de838aab0d5fc21d4cbfc455',
  /** Decoded by Blockscout on a real curve: CurveSell(address indexed seller, address indexed recipient, …). */
  v2CurveSell: '0x8113d738abdcb6b38357e9d53a54a7157861a09031b453651f0fe7fe151f59df',
  /** Emitted by the curve at launch for every snipe-tax-exempt wallet (decoded by Blockscout). */
  v2SnipeTaxExempted: '0xe4b7e48fbd47c2f602bacadee76ad33b16542ddb4997cfc0de04c311adcfa8c7',
  /** Verified factory ABI (Blockscout): PoolGraduated(address indexed token, uint256 positionId, uint256 tokenAmount, uint256 pairTokenAmount). */
  v2PoolGraduated: '0x0a44ef75df69c534f43cd6c1aa3ef8983065fe5fe79ef9e79f6494e6f258c259',
  /** Uniswap v3 Swap. Source: docs.ponsfamily.com ("Swap (topic0)"). */
  v3Swap: '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67',
  /** ERC-20 Transfer(address indexed from, address indexed to, uint256 value). Source: EIP-20 (eips.ethereum.org/EIPS/eip-20). */
  erc20Transfer: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
} as const;

/** V2 graduation phases. Source: docs.ponsfamily.com/v2 ("Launch Phases"). */
export const V2_PHASES = ['NotGraduated', 'Swept', 'PoolCreated', 'Rescued'] as const;

/** Public links shown in reports. */
export const LINKS = {
  /** Pons token page. Source: token links on https://www.ponsfamily.com/launchpad ("/launchpad/<address>"). */
  ponsToken: (token: string) => `https://www.ponsfamily.com/launchpad/${token}`,
  /** RobinScan (Etherscan for Robinhood Chain). Source: CLAUDE.md §2. */
  explorerAddress: (address: string) => `https://robin.etherscan.io/address/${address}`,
  explorerToken: (token: string) => `https://robin.etherscan.io/token/${token}`,
  explorerTx: (hash: string) => `https://robin.etherscan.io/tx/${hash}`,
} as const;

/** Pons contracts whose payouts count as "proceeds of a launch" when they fund a wallet. */
export const PONS_PAYOUT_CONTRACTS: Address[] = [PONS_V2.feeEscrow, PONS_V2.buybackVault, PONS_V2.launchAndBuyRouter];
