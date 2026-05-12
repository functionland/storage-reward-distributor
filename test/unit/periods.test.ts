import { describe, it, expect } from "vitest";
import {
  collectDuePeriods,
  groupByWindow,
  initialPeriodStates,
  perPeriodBudgetWei,
  periodWindow,
} from "../../src/domain/periods.js";
import type { Distribution } from "../../src/domain/distribution.js";

function makeDist(opts: {
  id?: string;
  totalAmountWei?: bigint;
  numPeriods?: number;
  periodDurationSec?: number;
  startTimestamp?: number;
  processedIndices?: number[];
}): Distribution {
  const numPeriods = opts.numPeriods ?? 4;
  const states = initialPeriodStates(numPeriods).map((s) => {
    if (opts.processedIndices?.includes(s.periodIndex)) {
      return { ...s, status: "processed" as const, processedAt: 1 };
    }
    return { ...s };
  });
  return {
    id: opts.id ?? "d1",
    createdAt: 0,
    totalAmountWei: (opts.totalAmountWei ?? 1000n * 10n ** 18n).toString(),
    numPeriods,
    periodDurationSec: opts.periodDurationSec ?? 12 * 3600,
    startTimestamp: opts.startTimestamp ?? 1_000_000,
    periodStates: states,
  };
}

describe("periodWindow", () => {
  it("computes a contiguous half-open interval", () => {
    const d = makeDist({ startTimestamp: 100, periodDurationSec: 60 });
    expect(periodWindow(d, 0)).toEqual({ start: 100, end: 160 });
    expect(periodWindow(d, 1)).toEqual({ start: 160, end: 220 });
    expect(periodWindow(d, 3)).toEqual({ start: 280, end: 340 });
  });
});

describe("perPeriodBudgetWei", () => {
  it("divides total by numPeriods", () => {
    const d = makeDist({ totalAmountWei: 1000n * 10n ** 18n, numPeriods: 4 });
    expect(perPeriodBudgetWei(d)).toBe(250n * 10n ** 18n);
  });
  it("integer-truncates remainder (dust)", () => {
    const d = makeDist({ totalAmountWei: 1001n, numPeriods: 4 });
    expect(perPeriodBudgetWei(d)).toBe(250n);
  });
});

describe("collectDuePeriods", () => {
  it("returns no due periods when none have elapsed", () => {
    const d = makeDist({ startTimestamp: 1000, periodDurationSec: 100 });
    expect(collectDuePeriods([d], 1050)).toEqual([]);
  });
  it("returns periods whose windowEnd <= now", () => {
    const d = makeDist({ startTimestamp: 1000, periodDurationSec: 100, numPeriods: 4 });
    const due = collectDuePeriods([d], 1250);
    expect(due.map((p) => p.periodIndex)).toEqual([0, 1]);
    expect(due[0].windowStart).toBe(1000);
    expect(due[0].windowEnd).toBe(1100);
  });
  it("skips already-processed periods", () => {
    const d = makeDist({
      startTimestamp: 1000,
      periodDurationSec: 100,
      numPeriods: 4,
      processedIndices: [0],
    });
    const due = collectDuePeriods([d], 1500);
    expect(due.map((p) => p.periodIndex)).toEqual([1, 2, 3]);
  });
  it("orders results by windowStart across multiple distributions (catch-up)", () => {
    const d1 = makeDist({ id: "d1", startTimestamp: 1000, periodDurationSec: 100, numPeriods: 2 });
    const d2 = makeDist({ id: "d2", startTimestamp: 1050, periodDurationSec: 100, numPeriods: 2 });
    const due = collectDuePeriods([d1, d2], 1300);
    const ids = due.map((p) => `${p.distributionId}#${p.periodIndex}`);
    // d1#0 [1000-1100), d2#0 [1050-1150), d1#1 [1100-1200), d2#1 [1150-1250)
    expect(ids).toEqual(["d1#0", "d2#0", "d1#1", "d2#1"]);
  });
});

describe("groupByWindow", () => {
  it("groups identical windows together so their budgets combine", () => {
    const due = [
      { distributionId: "d1", periodIndex: 5, windowStart: 100, windowEnd: 200, periodBudgetWei: 100n },
      { distributionId: "d2", periodIndex: 0, windowStart: 100, windowEnd: 200, periodBudgetWei: 200n },
      { distributionId: "d1", periodIndex: 6, windowStart: 200, windowEnd: 300, periodBudgetWei: 100n },
    ];
    const grouped = groupByWindow(due);
    expect(grouped.size).toBe(2);
    expect(grouped.get("100-200")?.length).toBe(2);
    expect(grouped.get("200-300")?.length).toBe(1);
  });
});
