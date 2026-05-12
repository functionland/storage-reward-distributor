/**
 * Budget aggregation: for a given (window, set of distributions contributing
 * to it), compute the per-peer reward.
 */
import type { DuePeriod } from "./distribution.js";

export function aggregateBudgetWei(periods: DuePeriod[]): bigint {
  let total = 0n;
  for (const p of periods) total += p.periodBudgetWei;
  return total;
}

/**
 * Given total budget and a count of unique online members, returns:
 *   - perPeerWei: the equal share (integer division; remainder is dust)
 *   - dustWei: the remainder lost to integer division
 *
 * If totalPeers is 0 or perPeerWei would be 0, returns zeros so the caller
 * skips the payout.
 */
export function splitBudget(
  totalBudgetWei: bigint,
  totalPeers: number,
): { perPeerWei: bigint; dustWei: bigint } {
  if (totalPeers <= 0) return { perPeerWei: 0n, dustWei: totalBudgetWei };
  const perPeerWei = totalBudgetWei / BigInt(totalPeers);
  const dustWei = totalBudgetWei - perPeerWei * BigInt(totalPeers);
  return { perPeerWei, dustWei };
}
