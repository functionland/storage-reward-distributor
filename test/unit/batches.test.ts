import { describe, it, expect } from "vitest";
import { splitIntoBatches } from "../../src/domain/batches.js";

describe("splitIntoBatches", () => {
  it("returns empty array for empty input", () => {
    expect(splitIntoBatches([], 10)).toEqual([]);
  });
  it("returns single chunk when items fit", () => {
    const r = splitIntoBatches([1, 2, 3], 10);
    expect(r).toEqual([[1, 2, 3]]);
  });
  it("splits at boundary", () => {
    const r = splitIntoBatches([1, 2, 3, 4, 5], 2);
    expect(r).toEqual([[1, 2], [3, 4], [5]]);
  });
  it("respects MAX_BATCH_SIZE default (250)", () => {
    const items = Array.from({ length: 601 }, (_, i) => i);
    const r = splitIntoBatches(items);
    expect(r.length).toBe(3);
    expect(r[0].length).toBe(250);
    expect(r[1].length).toBe(250);
    expect(r[2].length).toBe(101);
  });
  it("throws on non-positive size", () => {
    expect(() => splitIntoBatches([1, 2], 0)).toThrow();
    expect(() => splitIntoBatches([1, 2], -1)).toThrow();
  });
});
