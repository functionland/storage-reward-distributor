/**
 * Fetch online peerIds for a chain within a time window.
 *
 * Strategy:
 *  1. Find the block range covering [windowStart, windowEnd).
 *  2. Query `OnlineStatusSubmitted` events for poolId in that range.
 *     Chunk by MAX_BLOCKS_PER_LOG_QUERY to respect public-RPC limits.
 *  3. For each event tx, fetch the transaction calldata, decode the
 *     `submitOnlineStatusBatchV2(poolId, peerIds, timestamp)` arguments,
 *     and aggregate the unique peerIds.
 */
import type { ChainClient } from "../core/chains.js";
import { POOL_ID } from "../core/config.js";
import { MAX_BLOCKS_PER_LOG_QUERY } from "../core/constants.js";
import { log } from "../core/logger.js";
import { withRetry } from "../core/retry.js";
import { blockRangeForWindow } from "./block-range.js";

interface OnlineEvent {
  txHash: string;
  poolId: bigint;
  submitter: string;
  count: bigint;
  timestamp: bigint;
  blockNumber: number;
}

async function fetchOnlineEvents(
  c: ChainClient,
  fromBlock: number,
  toBlock: number,
): Promise<OnlineEvent[]> {
  const filter = c.rewardEngine.filters.OnlineStatusSubmitted(POOL_ID);
  const events: OnlineEvent[] = [];

  for (let start = fromBlock; start <= toBlock; start += MAX_BLOCKS_PER_LOG_QUERY) {
    const end = Math.min(start + MAX_BLOCKS_PER_LOG_QUERY - 1, toBlock);
    const logs = await withRetry(
      () => c.rewardEngine.queryFilter(filter, start, end),
      `queryFilter(${c.config.name}, ${start}-${end})`,
    );
    for (const ev of logs) {
      // `args` is a Result with named entries from the ABI fragment.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const a = (ev as any).args as {
        poolId: bigint;
        submitter: string;
        count: bigint;
        timestamp: bigint;
      };
      events.push({
        txHash: ev.transactionHash,
        poolId: a.poolId,
        submitter: a.submitter,
        count: a.count,
        timestamp: a.timestamp,
        blockNumber: ev.blockNumber,
      });
    }
  }
  return events;
}

async function decodePeerIdsFromTx(
  c: ChainClient,
  txHash: string,
): Promise<{ peerIds: string[]; timestamp: bigint } | null> {
  const tx = await withRetry(
    () => c.provider.getTransaction(txHash),
    `getTransaction(${txHash})`,
  );
  if (!tx) return null;

  try {
    const iface = c.rewardEngine.interface;
    const parsed = iface.parseTransaction({ data: tx.data, value: tx.value });
    if (!parsed) return null;
    if (parsed.name !== "submitOnlineStatusBatchV2") return null;

    const args = parsed.args;
    const peerIds: string[] = (args[1] as string[]).map((s) => s.toLowerCase());
    const timestamp: bigint = args[2] as bigint;
    return { peerIds, timestamp };
  } catch (err) {
    log.warn("decodePeerIdsFromTx: failed to parse", {
      chain: c.config.name,
      txHash,
      err: (err as Error).message,
    });
    return null;
  }
}

/**
 * Returns the union of peerIds (lowercase 0x... bytes32 strings) that were
 * submitted as online for `POOL_ID` on this chain whose `timestamp` argument
 * (the time the submitter said they were online) falls within
 * [windowStart, windowEnd).
 *
 * Note: we filter by the `timestamp` arg of submitOnlineStatusBatchV2 (i.e.,
 * the wall-clock time the peers were online), NOT by block.timestamp of the
 * submission. The contract allows submissions up to 7 days late, so the
 * block-time of a submission can be later than the actual online time.
 */
export async function fetchOnlinePeers(
  c: ChainClient,
  windowStart: number,
  windowEnd: number,
): Promise<string[]> {
  // Scan a slightly wider block range than the window to catch late submissions.
  // The contract permits up to 7 days late, but in practice operators submit
  // within minutes. We extend by 24h after windowEnd to be safe.
  const scanEnd = windowEnd + 24 * 60 * 60;
  const { fromBlock, toBlock } = await blockRangeForWindow(c, windowStart, scanEnd);
  log.debug("online-peers: scanning blocks", {
    chain: c.config.name,
    fromBlock,
    toBlock,
    windowStart,
    windowEnd,
  });

  const events = await fetchOnlineEvents(c, fromBlock, toBlock);
  log.debug("online-peers: events found", { chain: c.config.name, count: events.length });

  // Filter events whose `timestamp` arg falls within the window.
  const inWindow = events.filter(
    (e) => Number(e.timestamp) >= windowStart && Number(e.timestamp) < windowEnd,
  );

  // Decode peerIds from each in-window event's tx calldata.
  const peerSet = new Set<string>();
  for (const ev of inWindow) {
    const decoded = await decodePeerIdsFromTx(c, ev.txHash);
    if (!decoded) continue;
    for (const pid of decoded.peerIds) peerSet.add(pid);
  }

  return [...peerSet];
}
