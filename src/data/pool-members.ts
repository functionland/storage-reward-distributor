/**
 * Filter peerIds to actual pool members by querying
 * StoragePool.getPeerIdInfo(poolId, peerId) for each. Uses Multicall3 when
 * available; falls back to parallel direct calls otherwise.
 */
import { Interface, ZeroAddress } from "ethers";
import type { ChainClient } from "../core/chains.js";
import { POOL_ID } from "../core/config.js";
import { STORAGE_POOL_ABI } from "../core/abi.js";
import { log } from "../core/logger.js";
import { withRetry } from "../core/retry.js";

const MULTICALL_BATCH = 500;
const PARALLEL_DIRECT_BATCH = 50;

const storagePoolIface = new Interface(STORAGE_POOL_ABI as unknown as string[]);

/**
 * Returns the subset of `peerIds` whose `getPeerIdInfo(POOL_ID, peerId).member`
 * is non-zero (i.e., the peer is actually a member of the pool).
 */
export async function filterMembers(
  c: ChainClient,
  peerIds: readonly string[],
): Promise<string[]> {
  if (peerIds.length === 0) return [];

  // If Multicall3 isn't deployed on this chain (e.g., SKALE), fall back.
  if (!c.multicall3) {
    return filterMembersDirect(c, peerIds);
  }

  const members: string[] = [];
  for (let i = 0; i < peerIds.length; i += MULTICALL_BATCH) {
    const chunk = peerIds.slice(i, i + MULTICALL_BATCH);
    const calls = chunk.map((peerId) => ({
      target: c.config.storagePool,
      allowFailure: true,
      callData: storagePoolIface.encodeFunctionData("getPeerIdInfo", [POOL_ID, peerId]),
    }));

    const results = (await withRetry(
      () => c.multicall3!.aggregate3.staticCall(calls),
      `multicall3 getPeerIdInfo x${chunk.length} on ${c.config.name}`,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    )) as any[];

    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (!r.success) {
        log.warn("multicall sub-call failed", { peerId: chunk[j] });
        continue;
      }
      const decoded = storagePoolIface.decodeFunctionResult(
        "getPeerIdInfo",
        r.returnData,
      ) as unknown as [string, bigint];
      if (decoded[0] !== ZeroAddress) {
        members.push(chunk[j]);
      }
    }
  }
  return members;
}

async function filterMembersDirect(
  c: ChainClient,
  peerIds: readonly string[],
): Promise<string[]> {
  const members: string[] = [];
  for (let i = 0; i < peerIds.length; i += PARALLEL_DIRECT_BATCH) {
    const chunk = peerIds.slice(i, i + PARALLEL_DIRECT_BATCH);
    const results = await Promise.all(
      chunk.map(async (peerId) => {
        try {
          const [member] = (await withRetry(
            () => c.storagePool.getPeerIdInfo(POOL_ID, peerId),
            `getPeerIdInfo ${peerId.slice(0, 10)}…`,
          )) as [string, bigint];
          return member !== ZeroAddress ? peerId : null;
        } catch (err) {
          log.warn("getPeerIdInfo failed", { peerId, err: (err as Error).message });
          return null;
        }
      }),
    );
    for (const r of results) if (r) members.push(r);
  }
  return members;
}
