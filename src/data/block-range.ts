/**
 * Binary-search helper to find the block range covering a given time window
 * on a chain. Avoids scanning from genesis when we only care about a 12h
 * slice on a chain with ~2-3s blocks.
 */
import type { ChainClient } from "../core/chains.js";
import { withRetry } from "../core/retry.js";
import { log } from "../core/logger.js";

async function getBlockTimestamp(c: ChainClient, blockNumber: number): Promise<number> {
  const block = await withRetry(
    () => c.provider.getBlock(blockNumber),
    `getBlock(${blockNumber})`,
  );
  if (!block) throw new Error(`Block ${blockNumber} not found on ${c.config.name}`);
  return Number(block.timestamp);
}

/** Find the smallest block whose timestamp >= target, within [low, high]. */
async function findFirstBlockAtOrAfter(
  c: ChainClient,
  target: number,
  low: number,
  high: number,
): Promise<number> {
  let lo = low;
  let hi = high;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const ts = await getBlockTimestamp(c, mid);
    if (ts < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Returns [fromBlock, toBlock] covering blocks whose timestamps are within
 * [windowStart, windowEnd). Inclusive on both ends — `toBlock` is the LAST
 * block with timestamp < windowEnd.
 */
export async function blockRangeForWindow(
  c: ChainClient,
  windowStart: number,
  windowEnd: number,
): Promise<{ fromBlock: number; toBlock: number }> {
  const head = await withRetry(() => c.provider.getBlockNumber(), "getBlockNumber");
  const floor = c.config.eventScanFromBlock;

  if (head < floor) {
    // Chain reorg, or eventScanFromBlock misconfig — fall back to full range.
    return { fromBlock: 0, toBlock: head };
  }

  // Safety check: if eventScanFromBlock's timestamp is LATER than the window
  // we're trying to cover, we'd silently miss all events. Log a loud warning.
  try {
    const floorBlock = await withRetry(
      () => c.provider.getBlock(floor),
      `getBlock(floor=${floor})`,
    );
    if (floorBlock && Number(floorBlock.timestamp) > windowStart) {
      log.warn(
        "block-range: eventScanFromBlock is AFTER the requested window start. " +
          "Events from the early part of the window will be missed. " +
          "Lower CHAINS[<chain>].eventScanFromBlock in src/core/config.ts.",
        {
          chain: c.config.name,
          eventScanFromBlock: floor,
          floorBlockTimestamp: Number(floorBlock.timestamp),
          windowStart,
        },
      );
    }
  } catch {
    // Non-fatal — keep going.
  }

  // Find blocks straddling windowStart and windowEnd.
  const fromBlock = await findFirstBlockAtOrAfter(c, windowStart, floor, head);
  const lastBlockAtOrAfterEnd = await findFirstBlockAtOrAfter(c, windowEnd, fromBlock, head);
  const toBlock = Math.max(fromBlock, lastBlockAtOrAfterEnd - 1);

  return { fromBlock, toBlock };
}
