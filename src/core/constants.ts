/**
 * Tunable constants. Hard limits and defaults that should not change without
 * coordinated planning. See docs/OPERATIONS.md before adjusting.
 */

// ----- On-chain limits (matched to RewardEngine.sol) -----

/** Max peerIds per submitStorageRewardsBatch call. Mirrors MAX_BATCH_SIZE. */
export const MAX_BATCH_SIZE = 250;

/** Per-peer monthly cap on storage credits. Mirrors DEFAULT_MONTHLY_REWARD_PER_PEER (8000e18 wei). */
export const MAX_MONTHLY_STORAGE_PER_PEER_WEI = 8000n * 10n ** 18n;

/** Contract's expectedPeriod for online status bucketing (8 hours). Used to align event queries. */
export const CONTRACT_EXPECTED_PERIOD_SEC = 8 * 60 * 60;

// ----- Distributor defaults -----

/** Default duration of one distribution period (12 hours). User-configurable per distribution. */
export const DEFAULT_PERIOD_DURATION_SEC = 12 * 60 * 60;

// ----- Hard caps on inbox entries (defense-in-depth) -----

export const HARD_MAX_TOTAL_AMOUNT_TOKENS = 100_000n;
export const HARD_MAX_NUM_PERIODS = 60;
export const HARD_MIN_PERIOD_DURATION_SEC = 60 * 60; // 1h
export const HARD_MAX_PERIOD_DURATION_SEC = 24 * 60 * 60; // 24h
export const HARD_MAX_FUTURE_START_SEC = 30 * 24 * 60 * 60; // 30d
export const HARD_MIN_PAST_START_SEC = 60 * 60; // accept submissions starting up to 1h in the past
export const HARD_MAX_ACTIVE_DISTRIBUTIONS = 10;
export const HARD_MAX_MONTHLY_BUDGET_TOKENS = 1_000_000n;

// ----- Retry policy -----

export const RETRY_DELAYS_MS = [5_000, 20_000, 60_000];
export const RPC_CALL_TIMEOUT_MS = 30_000;

// ----- Block-range scanning -----

/** Max blocks to scan in a single eth_getLogs call. Most public RPCs limit to 10000. */
export const MAX_BLOCKS_PER_LOG_QUERY = 5_000;

/** Approx seconds per block by chain (for binary-search initial guess). */
export const SECONDS_PER_BLOCK = {
  base: 2,
  skale: 3,
} as const;
