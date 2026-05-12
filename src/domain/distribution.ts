/**
 * Domain types for distributions, periods, and inbox entries.
 */
import type { ChainName } from "../core/config.js";

export type PeriodStatus = "pending" | "processed" | "skipped" | "failed";

/**
 * Per-chain chunked-submission progress. Persisted mid-flight so a retry after
 * partial failure can resume from `chunksCompleted` instead of re-submitting
 * the chunks that already broadcasted (which would double-credit those peers).
 *
 * `peers` is the SORTED list cached on the first attempt — re-deriving from
 * chain state on retry could yield a different list (new members, etc.), so
 * we lock it in here for deterministic chunking.
 */
export interface ChainChunkProgress {
  peers: string[];
  chunksCompleted: number;
  perPeerWei: string;
}

export interface PeriodState {
  periodIndex: number;
  status: PeriodStatus;
  /** Tx hashes per chain (an array per chain because chunks may produce multiple txs). */
  txByChain?: Partial<Record<ChainName, string[]>>;
  onlineCount?: {
    skale: number;
    base: number;
    uniqueAfterDedupe: number;
  };
  perPeerWei?: string;
  skipReason?: string;
  failureReason?: string;
  processedAt?: number;
  /** Per-chain chunked-submission progress; cleared on full success. */
  chunkProgress?: Partial<Record<ChainName, ChainChunkProgress>>;
}

export interface Distribution {
  /** ULID — sortable id. */
  id: string;
  createdAt: number;
  totalAmountWei: string; // serialized bigint
  numPeriods: number;
  periodDurationSec: number;
  startTimestamp: number;
  periodStates: PeriodState[];
  /** Optional metadata for audit / dashboard. */
  submittedBy?: string;
  notes?: string;
}

export interface State {
  schemaVersion: 1;
  lastTick?: { ts: number; ranOnGitHub?: boolean };
  distributions: Distribution[];
}

export interface InboxEntry {
  submittedAt: number;
  submittedBy?: string;
  totalAmount: string; // in tokens (not wei) — UI uses human units
  numPeriods: number;
  periodDurationSec: number;
  /** Either "now" or an absolute unix-seconds timestamp. */
  startTimestamp: number | "now";
  notes?: string;
}

export interface Inbox {
  pending: InboxEntry[];
}

/**
 * A period that's due to be processed at `now`. Carries enough info to compute
 * the budget contribution of one distribution toward that period.
 */
export interface DuePeriod {
  distributionId: string;
  periodIndex: number;
  windowStart: number;
  windowEnd: number;
  periodBudgetWei: bigint;
}
