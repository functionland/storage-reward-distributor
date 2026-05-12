/**
 * Per-chain configuration. The poolId is fixed at 1 for both chains per the
 * single-pool operator decision documented in the plan.
 */

export type ChainName = "base" | "skale";

export interface ChainConfig {
  name: ChainName;
  chainId: number;
  rpcUrl: string;
  rewardEngine: `0x${string}`;
  storagePool: `0x${string}`;
  multicall3?: `0x${string}`; // Multicall3 at standard address if available
  /** Approximate seconds per block — used for event-range binary search. */
  secondsPerBlock: number;
  /**
   * Approximate block number on or around the time the RewardEngine was
   * deployed; sets a floor for event scanning so we don't bisect to genesis.
   */
  eventScanFromBlock: number;
}

const STANDARD_MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const;

export const CHAINS: Record<ChainName, ChainConfig> = {
  base: {
    name: "base",
    chainId: 8453,
    rpcUrl: process.env.BASE_RPC_URL?.trim() || "https://mainnet.base.org",
    rewardEngine: "0x31029f90405fd3D9cB0835c6d21b9DFF058Df45A",
    storagePool: "0xb093fF4B3B3B87a712107B26566e0cCE5E752b4D",
    multicall3: STANDARD_MULTICALL3,
    secondsPerBlock: 2,
    // Base mainnet block around RewardEngine deploy. Tune downward if you need
    // to scan further back; tune upward (closer to head) to speed scans.
    eventScanFromBlock: 45_911_321,
  },
  skale: {
    name: "skale",
    chainId: 2046399126,
    rpcUrl:
      process.env.SKALE_RPC_URL?.trim() ||
      "https://mainnet.skalenodes.com/v1/elated-tan-skat",
    rewardEngine: "0xF7c64248294C45Eb3AcdD282b58675F1831fb047",
    storagePool: "0xf9176Ffde541bF0aa7884298Ce538c471Ad0F015",
    // SKALE Europa Hub: Multicall3 is NOT at the standard address. We fall back
    // to parallel RPC calls if undefined. Verify at impl time and set if available.
    multicall3: undefined,
    secondsPerBlock: 3,
    eventScanFromBlock: 25_613_279,
  },
};

/** Single pool used by this deployment. */
export const POOL_ID = 1 as const;

/**
 * Cross-chain dedupe tiebreak preference. Per operator decision: a peerId
 * online on both chains is credited only on SKALE (its Base-side online entry
 * is dropped). Flip to "base" if needed without other code changes.
 */
export const DEDUPE_PREFERENCE: "skale" | "base" = "skale";

/**
 * GitHub usernames whose inbox entries are accepted. If empty, all entries
 * pass (single-operator deployments). Loaded from env so multi-operator
 * deployments can configure it without code changes.
 */
export function getAllowedSubmitters(): string[] {
  const raw = process.env.ALLOWED_SUBMITTERS?.trim() || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Whether the current run is a dry-run (no broadcast). */
export function isDryRun(): boolean {
  return process.env.DRY_RUN === "true";
}

/** Operator private key. Required for live ticks; optional for dry-run. */
export function getOperatorPrivateKey(): string | undefined {
  return process.env.OPERATOR_PRIVATE_KEY?.trim() || undefined;
}
