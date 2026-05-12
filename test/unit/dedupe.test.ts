import { describe, it, expect } from "vitest";
import { dedupeCrossChain } from "../../src/domain/dedupe.js";

describe("dedupeCrossChain (prefer skale)", () => {
  it("drops base entries that are also on skale", () => {
    const r = dedupeCrossChain(["a", "b", "c"], ["b", "d"], "skale");
    expect(r.skalePeers).toEqual(["a", "b", "c"]);
    expect(r.basePeers).toEqual(["d"]);
    expect(r.duplicatesDroppedFrom).toBe("base");
    expect(r.duplicatesDroppedCount).toBe(1);
  });
  it("matches the user's example: 10 SKALE + 5 Base (no overlap)", () => {
    const skale = Array.from({ length: 10 }, (_, i) => `s${i}`);
    const base = Array.from({ length: 5 }, (_, i) => `b${i}`);
    const r = dedupeCrossChain(skale, base, "skale");
    expect(r.skalePeers.length + r.basePeers.length).toBe(15);
    expect(r.duplicatesDroppedCount).toBe(0);
  });
  it("matches the dual-chain peer scenario: 1 SKALE + 1 Base + 1 on both", () => {
    const r = dedupeCrossChain(["x", "shared"], ["y", "shared"], "skale");
    // shared is only on SKALE; base keeps y.
    expect(r.skalePeers.sort()).toEqual(["shared", "x"]);
    expect(r.basePeers).toEqual(["y"]);
    expect(r.duplicatesDroppedCount).toBe(1);
  });
  it("empty inputs", () => {
    const r = dedupeCrossChain([], [], "skale");
    expect(r.skalePeers).toEqual([]);
    expect(r.basePeers).toEqual([]);
    expect(r.duplicatesDroppedCount).toBe(0);
  });
});

describe("dedupeCrossChain (prefer base, alternate config)", () => {
  it("drops skale entries that are also on base", () => {
    const r = dedupeCrossChain(["a", "b"], ["b", "c"], "base");
    expect(r.skalePeers).toEqual(["a"]);
    expect(r.basePeers).toEqual(["b", "c"]);
    expect(r.duplicatesDroppedFrom).toBe("skale");
    expect(r.duplicatesDroppedCount).toBe(1);
  });
});
