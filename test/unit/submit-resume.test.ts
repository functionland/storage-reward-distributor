/**
 * Unit test for submitInChunks's idempotency under skipChunks + onChunkComplete.
 * Mocks the chain client so we only exercise the iteration / resume logic.
 */
import { describe, it, expect } from "vitest";
import { submitInChunks } from "../../src/data/submit.js";

// Fake ChainClient that records what was "submitted" and never simulates
// MonthlyCapExceeded. Just enough to satisfy the static call.
function fakeClient() {
  const sent: { peers: readonly string[] }[] = [];
  const chainStub = {
    config: { name: "skale" },
    rewardEngineForWrite: () => ({
      submitStorageRewardsBatch: Object.assign(
        async () => ({
          hash: `0x${"a".repeat(64)}`,
          wait: async () => ({ status: 1, blockNumber: 1, gasUsed: 1n }),
        }),
        {
          staticCall: async (
            _pool: number,
            peerIds: readonly string[],
            _amount: bigint,
            _isCredit: boolean,
          ) => {
            sent.push({ peers: peerIds });
          },
        },
      ),
    }),
  };
  return { chainStub, sent };
}

describe("submitInChunks resume / idempotency", () => {
  it("skips the first N chunks when skipChunks=N", async () => {
    const { chainStub } = fakeClient();
    const peers = Array.from({ length: 500 }, (_, i) =>
      ("0x" + i.toString(16).padStart(64, "0")) as string,
    );
    const calls: number[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await submitInChunks(chainStub as any, peers, 1n, {
      skipChunks: 1,
      onChunkComplete: async (n) => { calls.push(n); },
    });
    // 500 peers / 250 batch size = 2 chunks. skipChunks=1 → only the second chunk runs.
    expect(result.chunksCompleted).toBe(2);
    expect(calls).toEqual([2]); // only one onChunkComplete invocation, with cumulative count = 2
  });

  it("invokes onChunkComplete after every successful chunk", async () => {
    const { chainStub } = fakeClient();
    const peers = Array.from({ length: 600 }, (_, i) =>
      ("0x" + i.toString(16).padStart(64, "0")) as string,
    );
    const calls: number[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await submitInChunks(chainStub as any, peers, 1n, {
      onChunkComplete: async (n) => { calls.push(n); },
    });
    expect(result.chunksCompleted).toBe(3); // 600/250 = 3 chunks
    expect(calls).toEqual([1, 2, 3]);
  });

  it("returns chunksCompleted=skipChunks when peers list is empty", async () => {
    const { chainStub } = fakeClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await submitInChunks(chainStub as any, [], 1n, { skipChunks: 2 });
    expect(result.chunksCompleted).toBe(2);
    expect(result.txHashes).toEqual([]);
  });
});
