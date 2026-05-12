/**
 * Cap-aware on-chain submission of storage rewards.
 *
 * The contract enforces a per-peer monthly cap of 8000 tokens. If a credit
 * would exceed that for any peer in the batch, the WHOLE batch reverts with
 * `MonthlyCapExceeded`. We use eth_call to simulate first; on revert, we
 * binary-search the offending peer(s), drop them, and retry.
 */
import { Interface, type ContractTransactionResponse } from "ethers";
import type { ChainClient } from "../core/chains.js";
import { POOL_ID, isDryRun } from "../core/config.js";
import { REWARD_ENGINE_ABI } from "../core/abi.js";
import { splitIntoBatches } from "../domain/batches.js";
import { log } from "../core/logger.js";
import { withRetry } from "../core/retry.js";

const rewardEngineIface = new Interface(REWARD_ENGINE_ABI as unknown as string[]);

const SELECTOR_MONTHLY_CAP_EXCEEDED = (() => {
  const frag = rewardEngineIface.getError("MonthlyCapExceeded");
  if (!frag) throw new Error("MonthlyCapExceeded error not in ABI");
  return rewardEngineIface.getError("MonthlyCapExceeded")!.selector;
})();

export interface SubmitResult {
  txHashes: string[];
  /** Peers we had to drop because they'd exceed the monthly cap. */
  droppedPeers: string[];
  /** Number of chunks that successfully broadcast in this call. */
  chunksCompleted: number;
}

export interface SubmitOptions {
  /**
   * Skip the first N batches (already broadcast in a prior attempt). Caller
   * is responsible for passing a DETERMINISTIC peerIds list (i.e., the same
   * sorted list that produced the prior partial result).
   */
  skipChunks?: number;
  /**
   * Invoked after each successful chunk so the caller can persist progress.
   * If the callback throws, we don't broadcast further chunks — but the
   * already-completed count is correct.
   */
  onChunkComplete?: (chunksCompleted: number, txHash: string | undefined) => Promise<void>;
}

/**
 * Submit storage-reward credits in batches of <= MAX_BATCH_SIZE.
 *
 * Idempotency contract: callers must pass a sorted, stable `peerIds` list.
 * The chunking is deterministic (`splitIntoBatches` slices in order). On
 * retry, pass `skipChunks` = the previously-completed count so we skip the
 * chunks already on-chain.
 */
export async function submitInChunks(
  c: ChainClient,
  peerIds: readonly string[],
  perPeerWei: bigint,
  opts: SubmitOptions = {},
): Promise<SubmitResult> {
  const txHashes: string[] = [];
  const droppedPeers: string[] = [];
  const skipChunks = opts.skipChunks ?? 0;

  if (peerIds.length === 0 || perPeerWei === 0n) {
    return { txHashes, droppedPeers, chunksCompleted: skipChunks };
  }

  const batches = splitIntoBatches(peerIds);
  let chunksCompleted = skipChunks;

  for (let i = 0; i < batches.length; i++) {
    if (i < skipChunks) continue; // already broadcast on a prior attempt
    const batch = batches[i];

    // Re-simulate against current chain state on each attempt — handles the
    // case where on-chain monthlyStorageCredited shifted since the prior tick.
    const trimmed = await trimByCapSim(c, batch, perPeerWei, droppedPeers);
    if (trimmed.length === 0) {
      log.warn("submit: batch fully trimmed by cap", {
        chain: c.config.name,
        batchIndex: i,
      });
      chunksCompleted = i + 1;
      if (opts.onChunkComplete) await opts.onChunkComplete(chunksCompleted, undefined);
      continue;
    }

    // Broadcast with a safety net: if the broadcast reverts with
    // MonthlyCapExceeded (state moved between simulate and broadcast),
    // re-bisect and retry once.
    let txHash: string | undefined;
    try {
      txHash = await submitOne(c, trimmed, perPeerWei);
    } catch (err) {
      if (isMonthlyCapError(err)) {
        log.warn("submit: broadcast hit cap (state moved); re-bisecting", {
          chain: c.config.name,
          batchIndex: i,
        });
        const re = await trimByCapSim(c, trimmed, perPeerWei, droppedPeers);
        if (re.length === 0) {
          log.warn("submit: chunk fully trimmed on re-bisect", {
            chain: c.config.name,
            batchIndex: i,
          });
          chunksCompleted = i + 1;
          if (opts.onChunkComplete) await opts.onChunkComplete(chunksCompleted, undefined);
          continue;
        }
        txHash = await submitOne(c, re, perPeerWei);
      } else {
        // Non-cap error: surface to caller; chunksCompleted reflects only
        // the chunks that fully succeeded. Caller persists this and retries.
        throw err;
      }
    }

    if (txHash) txHashes.push(txHash);
    chunksCompleted = i + 1;
    if (opts.onChunkComplete) await opts.onChunkComplete(chunksCompleted, txHash);
  }
  return { txHashes, droppedPeers, chunksCompleted };
}

async function submitOne(
  c: ChainClient,
  peerIds: readonly string[],
  perPeerWei: bigint,
): Promise<string | undefined> {
  if (isDryRun()) {
    log.info("DRY_RUN: would submit", {
      chain: c.config.name,
      poolId: POOL_ID,
      peerCount: peerIds.length,
      perPeerWei: perPeerWei.toString(),
      firstFew: peerIds.slice(0, 3),
    });
    return undefined;
  }

  const writeContract = c.rewardEngineForWrite();
  const tx = (await withRetry(
    () =>
      writeContract.submitStorageRewardsBatch(
        POOL_ID,
        peerIds,
        perPeerWei,
        true,
      ) as Promise<ContractTransactionResponse>,
    `submitStorageRewardsBatch[${c.config.name}, ${peerIds.length} peers]`,
  )) as ContractTransactionResponse;

  log.info("submit: tx sent", {
    chain: c.config.name,
    txHash: tx.hash,
    peerCount: peerIds.length,
    perPeerWei: perPeerWei.toString(),
  });

  // Wait for confirmation. Base is an L2 — use 2 confirmations to reduce
  // reorg risk further (L1-propagated reorgs are very rare but theoretically
  // possible). SKALE has 1-block finality, so 1 is sufficient there.
  const confirmations = c.config.name === "base" ? 2 : 1;
  const receipt = await withRetry(() => tx.wait(confirmations), `tx.wait ${tx.hash}`);
  if (!receipt || receipt.status !== 1) {
    throw new Error(`Tx reverted: ${tx.hash}`);
  }
  log.info("submit: tx confirmed", {
    chain: c.config.name,
    txHash: tx.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
  });
  return tx.hash;
}

/**
 * Simulate the batch via eth_call. If it reverts with MonthlyCapExceeded,
 * binary-search the offending peer(s), drop them, and recurse.
 *
 * Returns the (potentially trimmed) peer list that simulates clean.
 */
async function trimByCapSim(
  c: ChainClient,
  peerIds: readonly string[],
  perPeerWei: bigint,
  droppedAccumulator: string[],
): Promise<readonly string[]> {
  if (peerIds.length === 0) return peerIds;

  const ok = await simulateOk(c, peerIds, perPeerWei);
  if (ok) return peerIds;

  if (peerIds.length === 1) {
    log.warn("submit: dropping peer that hits monthly cap", {
      chain: c.config.name,
      peerId: peerIds[0],
    });
    droppedAccumulator.push(peerIds[0]);
    return [];
  }

  // Bisect to find the offender(s).
  const mid = Math.floor(peerIds.length / 2);
  const left = await trimByCapSim(c, peerIds.slice(0, mid), perPeerWei, droppedAccumulator);
  const right = await trimByCapSim(c, peerIds.slice(mid), perPeerWei, droppedAccumulator);
  return [...left, ...right];
}

async function simulateOk(
  c: ChainClient,
  peerIds: readonly string[],
  perPeerWei: bigint,
): Promise<boolean> {
  try {
    // staticCall = eth_call: simulate without broadcasting.
    await c
      .rewardEngineForWrite()
      .submitStorageRewardsBatch.staticCall(POOL_ID, peerIds, perPeerWei, true);
    return true;
  } catch (err) {
    if (isMonthlyCapError(err)) return false;
    // Some other error — re-throw so the caller doesn't silently swallow.
    throw err;
  }
}

export function isMonthlyCapError(err: unknown): boolean {
  // ethers v6 surfaces revert data on err.data or err.info.error.data.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = err as any;
  const data: string | undefined =
    e?.data ?? e?.error?.data ?? e?.info?.error?.data ?? e?.revert?.data ?? undefined;
  if (typeof data === "string" && data.startsWith(SELECTOR_MONTHLY_CAP_EXCEEDED)) {
    return true;
  }
  const errMsg: string | undefined = e?.message ?? "";
  if (typeof errMsg === "string" && errMsg.includes("MonthlyCapExceeded")) return true;
  return false;
}
