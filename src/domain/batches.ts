/**
 * Batching: split a peer list into chunks of MAX_BATCH_SIZE.
 *
 * Trim-by-cap is in `data/monthly-cap.ts` because it requires on-chain reads
 * (simulating `submitStorageRewardsBatch` via eth_call to detect the
 * MonthlyCapExceeded revert).
 */
import { MAX_BATCH_SIZE } from "../core/constants.js";

export function splitIntoBatches<T>(items: readonly T[], size: number = MAX_BATCH_SIZE): T[][] {
  if (size <= 0) throw new Error("batch size must be > 0");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
