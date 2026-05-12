/**
 * Period math: which periods are due, what's their time window, what's their
 * budget contribution.
 */
import type { Distribution, DuePeriod } from "./distribution.js";

export function periodWindow(d: Distribution, periodIndex: number): { start: number; end: number } {
  const start = d.startTimestamp + periodIndex * d.periodDurationSec;
  const end = start + d.periodDurationSec;
  return { start, end };
}

export function perPeriodBudgetWei(d: Distribution): bigint {
  const total = BigInt(d.totalAmountWei);
  return total / BigInt(d.numPeriods);
}

/**
 * Returns all (distribution, periodIndex) pairs that:
 *  - belong to a distribution that has periods left to process
 *  - have a window that already closed (windowEnd <= now)
 *  - are not already processed
 *
 * Ordered by windowStart ascending so older work is done first (catch-up after
 * downtime).
 */
export function collectDuePeriods(distributions: Distribution[], now: number): DuePeriod[] {
  const due: DuePeriod[] = [];
  for (const d of distributions) {
    const budget = perPeriodBudgetWei(d);
    for (let i = 0; i < d.numPeriods; i++) {
      const ps = d.periodStates[i];
      if (!ps) continue;
      if (ps.status === "processed" || ps.status === "skipped") continue;
      const { start, end } = periodWindow(d, i);
      if (end > now) break; // periods are in order; later ones are even further in the future
      due.push({
        distributionId: d.id,
        periodIndex: i,
        windowStart: start,
        windowEnd: end,
        periodBudgetWei: budget,
      });
    }
  }
  due.sort((a, b) => a.windowStart - b.windowStart);
  return due;
}

/**
 * Group periods by identical time window. Two distributions whose periods cover
 * the same wall-clock interval are processed together (their budgets combine
 * for that interval).
 */
export function groupByWindow(due: DuePeriod[]): Map<string, DuePeriod[]> {
  const byWindow = new Map<string, DuePeriod[]>();
  for (const p of due) {
    const key = `${p.windowStart}-${p.windowEnd}`;
    const arr = byWindow.get(key);
    if (arr) arr.push(p);
    else byWindow.set(key, [p]);
  }
  return byWindow;
}

/** Initialize empty period states for a fresh distribution. */
export function initialPeriodStates(numPeriods: number): { periodIndex: number; status: "pending" }[] {
  return Array.from({ length: numPeriods }, (_, i) => ({
    periodIndex: i,
    status: "pending" as const,
  }));
}
