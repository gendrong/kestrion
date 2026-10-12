# Phase 1a — Chain research (STOP for approval at the end)

> Paste this whole file as the prompt. The full product spec lives in `CLAUDE.md`; read it first.

## Goal
Find and verify every on-chain fact the scanning engine needs, and show them to me with sources.
**Do not write any engine code in this phase.**

## Read first
- `CLAUDE.md` §2 (Chain facts), §3 (Sources of truth), §7 (Risk engine — so you know what data the checks need)
- Every source listed in §3:
  - https://docs.ponsfamily.com
  - https://docs.mobula.io/almanac/robinhood-launchpads/pons
  - https://github.com/pons-labs
  - https://ponsfamily.com/builders
  - Verified contracts on https://robin.etherscan.io

## Tasks
1. **Pons factories**: find the ACTIVE factory address and the LEGACY factory address on Robinhood Chain (chainId 4663).
2. **`TokenLaunched` event**: exact event signature (name, parameter types, which are indexed) for each factory. Note any difference between active and legacy.
3. **`getLaunchedToken`**: exact function signature and return fields (token, paired token, fee, position manager, position ID, source factory).
4. **Relevant ABIs**: factory, position manager (Uniswap v3-style), pool, and ERC-20 parts we need. Note where each ABI came from (verified source on the explorer, GitHub repo + commit, or docs page).
5. **Snipe-tax whitelist**: how exempt wallets are stored or emitted (event? mapping? config at launch?) and how we can read them.
6. **Curve / graduation**: how bonding progress and graduation can be read or derived on-chain.
7. **Locker / burn addresses**: any known locker contracts or burn addresses we must exclude from holder concentration.
8. **RPC**: a working public RPC URL for chainId 4663. Prove it works: call `eth_chainId` and `eth_blockNumber` and show the output.
9. **Data gaps**: for each of the 8 checks in §7, say whether the needed data is available on-chain / via explorer API / not available. If something isn't available, propose an alternative (do not fake it).

## Rules
- NEVER invent addresses, ABIs, RPC URLs, or event signatures. Every item needs a source link.
- If something can't be verified, mark it **UNVERIFIED** and ask me — don't guess.
- You may write small throwaway scripts to test the RPC, but don't create the monorepo yet.

## Deliverable
A table like this, in your reply AND saved to `docs/chain-research.md`:

| Item | Value | Source |
|---|---|---|
| Active factory | 0x… | link |
| Legacy factory | 0x… | link |
| `TokenLaunched` | `event TokenLaunched(...)` | link |
| … | … | … |

Plus the data-gap list from task 9.

## STOP
End the phase here and **wait for my OK** before starting Phase 1b.
