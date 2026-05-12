import { describe, it, expect } from "vitest";
import { aggregateBudgetWei, splitBudget } from "../../src/domain/budget.js";

describe("aggregateBudgetWei", () => {
  it("sums periodBudgetWei across due periods (overlapping distributions)", () => {
    const due = [
      { distributionId: "d1", periodIndex: 5, windowStart: 0, windowEnd: 1, periodBudgetWei: 100n },
      { distributionId: "d2", periodIndex: 0, windowStart: 0, windowEnd: 1, periodBudgetWei: 200n },
    ];
    expect(aggregateBudgetWei(due)).toBe(300n);
  });
  it("returns 0 for empty input", () => {
    expect(aggregateBudgetWei([])).toBe(0n);
  });
});

describe("splitBudget", () => {
  it("divides equally with dust", () => {
    const r = splitBudget(1000n, 7);
    expect(r.perPeerWei).toBe(142n);
    expect(r.dustWei).toBe(1000n - 142n * 7n);
  });
  it("returns zeros for zero peers", () => {
    expect(splitBudget(1000n, 0)).toEqual({ perPeerWei: 0n, dustWei: 1000n });
  });
  it("handles per-peer dust when budget < peers", () => {
    const r = splitBudget(3n, 10);
    expect(r.perPeerWei).toBe(0n);
    expect(r.dustWei).toBe(3n);
  });
  it("handles the user's example: 1000e18 over 4 periods, period budget across 15 peers", () => {
    const total = (1000n * 10n ** 18n) / 4n; // 250e18
    const r = splitBudget(total, 15);
    // 250e18 / 15 = 16666666666666666666 + dust
    expect(r.perPeerWei * 15n + r.dustWei).toBe(total);
  });
});
