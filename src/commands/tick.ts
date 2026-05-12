/**
 * Main cron entrypoint: process all due periods, on both chains, with the
 * cross-chain dedupe and per-peer-cap awareness.
 */
import { loadState, saveState } from "../data/state.js";
import { ingest } from "./ingest.js";
import { collectDuePeriods, groupByWindow } from "../domain/periods.js";
import { aggregateBudgetWei, splitBudget } from "../domain/budget.js";
import { dedupeCrossChain } from "../domain/dedupe.js";
import { fetchOnlinePeers } from "../data/online-peers.js";
import { filterMembers } from "../data/pool-members.js";
import { submitInChunks } from "../data/submit.js";
import { ChainClient, getClient } from "../core/chains.js";
import { log } from "../core/logger.js";
import type { ChainName } from "../core/config.js";
import type { Distribution, PeriodState } from "../domain/distribution.js";

export async function tick(now: number = Math.floor(Date.now() / 1000)): Promise<void> {
  log.info("tick: start", { now });

  // 1. Drain inbox into state (validated + materialized).
  await ingest(now);

  // 2. Re-load state (ingest mutated it). Compute due periods.
  let state = await loadState();
  const due = collectDuePeriods(state.distributions, now);
  if (due.length === 0) {
    log.info("tick: no due periods");
    state.lastTick = { ts: now, ranOnGitHub: !!process.env.GITHUB_ACTIONS };
    await saveState(state);
    return;
  }
  log.info("tick: due periods", { count: due.length });

  // 3. Group due periods by their shared window. Periods that share the same
  //    wall-clock window combine budgets and split equally among the same
  //    online-member set.
  const groups = groupByWindow(due);

  // 4. Process each window in order.
  const sortedWindows = [...groups.entries()].sort((a, b) => {
    const aStart = a[1][0].windowStart;
    const bStart = b[1][0].windowStart;
    return aStart - bStart;
  });

  for (const [key, periods] of sortedWindows) {
    const windowStart = periods[0].windowStart;
    const windowEnd = periods[0].windowEnd;
    log.info("tick: processing window", {
      key,
      windowStart,
      windowEnd,
      contributingDistributions: periods.length,
    });

    try {
      await processWindow(state, periods, windowStart, windowEnd, now);
      // Persist after every window so a later failure doesn't lose prior progress.
      await saveState(state);
      state = await loadState();
    } catch (err) {
      log.error("tick: window failed; marking periods pending for retry", {
        key,
        err: (err as Error).message,
      });
      // We mark these as 'pending' (NOT 'failed') so the next tick retries.
      // The chunkProgress in state.json captures how far we got, so the retry
      // resumes from there without double-crediting completed chunks.
      // The failureReason is preserved on the period state for visibility.
      for (const p of periods) {
        const ps = findPeriodState(state, p.distributionId, p.periodIndex);
        if (ps) {
          ps.status = "pending";
          ps.failureReason = (err as Error).message;
        }
      }
      await saveState(state);
      state = await loadState();
    }
  }

  state.lastTick = { ts: now, ranOnGitHub: !!process.env.GITHUB_ACTIONS };
  await saveState(state);
  log.info("tick: complete");
}

interface DuePeriodLike {
  distributionId: string;
  periodIndex: number;
  windowStart: number;
  windowEnd: number;
  periodBudgetWei: bigint;
}

async function processWindow(
  state: { distributions: Distribution[] },
  periods: DuePeriodLike[],
  windowStart: number,
  windowEnd: number,
  now: number,
): Promise<void> {
  const skaleClient = getClient("skale");
  const baseClient = getClient("base");

  // Periods sharing a window share their submission. We anchor the resume
  // state on the LEAD period (lowest periodIndex of its distribution) — all
  // other periods in this window mirror the same chunk progress.
  const leadPeriodState = findPeriodState(state, periods[0].distributionId, periods[0].periodIndex);
  const leadProgress = leadPeriodState?.chunkProgress;

  // Decide whether to use cached peers (retry) or compute fresh (first attempt).
  let skalePeers: string[];
  let basePeers: string[];
  let perPeerWei: bigint;
  let skaleMembersCount = 0;
  let baseMembersCount = 0;

  if (leadProgress?.skale && leadProgress.skale.peers.length > 0) {
    // Resume: use cached peer list and perPeerWei.
    skalePeers = leadProgress.skale.peers;
    basePeers = leadProgress.base?.peers ?? [];
    perPeerWei = BigInt(leadProgress.skale.perPeerWei);
    log.info("tick: resuming from cached chunk progress", {
      skale: { peers: skalePeers.length, completedChunks: leadProgress.skale.chunksCompleted },
      base: leadProgress.base
        ? { peers: basePeers.length, completedChunks: leadProgress.base.chunksCompleted }
        : undefined,
    });
  } else if (leadProgress?.base && leadProgress.base.peers.length > 0) {
    // Same but only base side has progress.
    skalePeers = [];
    basePeers = leadProgress.base.peers;
    perPeerWei = BigInt(leadProgress.base.perPeerWei);
    log.info("tick: resuming from cached chunk progress (base only)", {
      peers: basePeers.length,
      completedChunks: leadProgress.base.chunksCompleted,
    });
  } else {
    // Fresh start: discover peers on-chain.
    const [skaleOnline, baseOnline] = await Promise.all([
      fetchOnlinePeers(skaleClient, windowStart, windowEnd),
      fetchOnlinePeers(baseClient, windowStart, windowEnd),
    ]);
    log.info("tick: online peers", { skale: skaleOnline.length, base: baseOnline.length });

    const [skaleMembers, baseMembers] = await Promise.all([
      filterMembers(skaleClient, skaleOnline),
      filterMembers(baseClient, baseOnline),
    ]);
    skaleMembersCount = skaleMembers.length;
    baseMembersCount = baseMembers.length;
    log.info("tick: pool members", { skale: skaleMembersCount, base: baseMembersCount });

    const ded = dedupeCrossChain(skaleMembers, baseMembers);
    const totalUnique = ded.skalePeers.length + ded.basePeers.length;
    log.info("tick: dedupe", {
      skalePeers: ded.skalePeers.length,
      basePeers: ded.basePeers.length,
      duplicatesDropped: ded.duplicatesDroppedCount,
      droppedFrom: ded.duplicatesDroppedFrom,
      totalUnique,
    });

    const totalBudgetWei = aggregateBudgetWei(periods);
    const split = splitBudget(totalBudgetWei, totalUnique);

    if (totalUnique === 0) {
      markAll(state, periods, "skipped", { reason: "no online members" }, now);
      return;
    }
    if (split.perPeerWei === 0n) {
      markAll(state, periods, "skipped", { reason: "perPeerWei rounded to zero" }, now);
      return;
    }

    // SORT for deterministic chunking on retry.
    skalePeers = [...ded.skalePeers].sort();
    basePeers = [...ded.basePeers].sort();
    perPeerWei = split.perPeerWei;
  }

  const totalUnique = skalePeers.length + basePeers.length;

  // Initialize / refresh chunk-progress entries on the lead period state.
  // Mirror across all periods in this window so any one of them can resume.
  for (const p of periods) {
    const ps = findPeriodState(state, p.distributionId, p.periodIndex);
    if (!ps) continue;
    ps.onlineCount = {
      skale: skaleMembersCount || (leadPeriodState?.onlineCount?.skale ?? skalePeers.length),
      base: baseMembersCount || (leadPeriodState?.onlineCount?.base ?? basePeers.length),
      uniqueAfterDedupe: totalUnique,
    };
    ps.perPeerWei = perPeerWei.toString();
    ps.chunkProgress ??= {};
    if (skalePeers.length > 0 && !ps.chunkProgress.skale) {
      ps.chunkProgress.skale = {
        peers: skalePeers,
        chunksCompleted: 0,
        perPeerWei: perPeerWei.toString(),
      };
    }
    if (basePeers.length > 0 && !ps.chunkProgress.base) {
      ps.chunkProgress.base = {
        peers: basePeers,
        chunksCompleted: 0,
        perPeerWei: perPeerWei.toString(),
      };
    }
  }
  await saveState({ ...state, schemaVersion: 1 });

  // Submit on each chain, persisting after every chunk.
  const txByChain: Partial<Record<ChainName, string[]>> = leadPeriodState?.txByChain
    ? { ...leadPeriodState.txByChain }
    : {};

  if (skalePeers.length > 0) {
    txByChain.skale ??= [];
    await submitChainWithResume(
      state,
      periods,
      "skale",
      skaleClient,
      skalePeers,
      perPeerWei,
      txByChain,
    );
  }
  if (basePeers.length > 0) {
    txByChain.base ??= [];
    await submitChainWithResume(
      state,
      periods,
      "base",
      baseClient,
      basePeers,
      perPeerWei,
      txByChain,
    );
  }

  // 7. Mark all contributing periods processed.
  for (const p of periods) {
    const ps = findPeriodState(state, p.distributionId, p.periodIndex);
    if (!ps) continue;
    ps.status = "processed";
    ps.txByChain = txByChain;
    ps.processedAt = now;
    // Keep chunkProgress in state for audit; it's redundant after processed.
    // (Could delete it here if size becomes a concern.)
  }
}

async function submitChainWithResume(
  state: { distributions: Distribution[] },
  periods: DuePeriodLike[],
  chain: ChainName,
  client: ChainClient,
  peers: readonly string[],
  perPeerWei: bigint,
  txByChain: Partial<Record<ChainName, string[]>>,
): Promise<void> {
  // Find the highest chunksCompleted across the periods (all should be equal,
  // but be defensive). This is our resume point.
  let skipChunks = 0;
  for (const p of periods) {
    const ps = findPeriodState(state, p.distributionId, p.periodIndex);
    const cp = ps?.chunkProgress?.[chain];
    if (cp && cp.chunksCompleted > skipChunks) skipChunks = cp.chunksCompleted;
  }

  const result = await submitInChunks(client, peers, perPeerWei, {
    skipChunks,
    onChunkComplete: async (chunksCompleted, txHash) => {
      if (txHash) {
        const arr = txByChain[chain];
        if (arr) arr.push(txHash);
      }
      // Persist chunksCompleted across all periods in this window.
      for (const p of periods) {
        const ps = findPeriodState(state, p.distributionId, p.periodIndex);
        if (ps?.chunkProgress?.[chain]) {
          ps.chunkProgress[chain]!.chunksCompleted = chunksCompleted;
        }
        if (ps) ps.txByChain = txByChain;
      }
      await saveState({ ...state, schemaVersion: 1 });
    },
  });
  log.info("tick: chain submission complete", {
    chain,
    chunksCompleted: result.chunksCompleted,
    droppedPeers: result.droppedPeers.length,
  });
}

function findPeriodState(
  state: { distributions: Distribution[] },
  distId: string,
  periodIndex: number,
): PeriodState | undefined {
  const d = state.distributions.find((d) => d.id === distId);
  return d?.periodStates.find((p) => p.periodIndex === periodIndex);
}

function markAll(
  state: { distributions: Distribution[] },
  periods: DuePeriodLike[],
  status: "skipped" | "processed" | "failed",
  meta: { reason?: string },
  now: number,
): void {
  for (const p of periods) {
    const ps = findPeriodState(state, p.distributionId, p.periodIndex);
    if (!ps) continue;
    ps.status = status;
    if (meta.reason && status === "skipped") ps.skipReason = meta.reason;
    if (meta.reason && status === "failed") ps.failureReason = meta.reason;
    ps.processedAt = now;
  }
}
