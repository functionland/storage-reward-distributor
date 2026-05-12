/**
 * Cross-chain dedupe.
 *
 * Operator decision: a peerId online on BOTH chains is counted once and
 * credited only on SKALE. The peer's Base-side online entry is dropped.
 * Rationale: SKALE has zero gas; cheaper for the operator AND for the member
 * to claim.
 *
 * The preference is configurable via DEDUPE_PREFERENCE in core/config.ts.
 */
import { DEDUPE_PREFERENCE } from "../core/config.js";

export interface DedupeResult {
  /** Peers that will be credited on SKALE. */
  skalePeers: string[];
  /** Peers that will be credited on Base. */
  basePeers: string[];
  /** PeerIds that were on both chains and got dropped from the non-preferred chain. */
  duplicatesDroppedFrom: "base" | "skale";
  duplicatesDroppedCount: number;
}

export function dedupeCrossChain(
  skaleMembers: readonly string[],
  baseMembers: readonly string[],
  preference: "skale" | "base" = DEDUPE_PREFERENCE,
): DedupeResult {
  if (preference === "skale") {
    const skaleSet = new Set(skaleMembers);
    const basePeers = baseMembers.filter((p) => !skaleSet.has(p));
    return {
      skalePeers: [...skaleMembers],
      basePeers,
      duplicatesDroppedFrom: "base",
      duplicatesDroppedCount: baseMembers.length - basePeers.length,
    };
  }
  // preference === "base"
  const baseSet = new Set(baseMembers);
  const skalePeers = skaleMembers.filter((p) => !baseSet.has(p));
  return {
    skalePeers,
    basePeers: [...baseMembers],
    duplicatesDroppedFrom: "skale",
    duplicatesDroppedCount: skaleMembers.length - skalePeers.length,
  };
}
