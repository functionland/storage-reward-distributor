/**
 * Print a human-readable status of pending and processed distributions.
 */
import { formatEther } from "ethers";
import { loadState } from "../data/state.js";
import { loadInbox } from "../data/inbox.js";
import { collectDuePeriods } from "../domain/periods.js";

export async function status(now: number = Math.floor(Date.now() / 1000)): Promise<void> {
  const [state, inbox] = await Promise.all([loadState(), loadInbox()]);
  console.log("=== storage-reward-distributor status ===");
  console.log(`now: ${new Date(now * 1000).toISOString()}`);
  if (state.lastTick) {
    console.log(`lastTick: ${new Date(state.lastTick.ts * 1000).toISOString()}`);
  } else {
    console.log("lastTick: (never)");
  }
  console.log();

  console.log(`inbox.pending: ${inbox.pending.length}`);
  for (const e of inbox.pending) {
    console.log(
      `  • ${e.totalAmount} tokens × ${e.numPeriods} periods (${e.periodDurationSec}s each), start=${e.startTimestamp}, by=${e.submittedBy ?? "(unknown)"}`,
    );
  }
  console.log();

  console.log(`distributions: ${state.distributions.length}`);
  for (const d of state.distributions) {
    const processed = d.periodStates.filter((p) => p.status === "processed").length;
    const pending = d.periodStates.filter((p) => p.status === "pending").length;
    const failed = d.periodStates.filter((p) => p.status === "failed").length;
    const skipped = d.periodStates.filter((p) => p.status === "skipped").length;
    console.log(
      `  ${d.id.slice(0, 10)}…: ${formatEther(d.totalAmountWei)} tokens / ${d.numPeriods} periods (${d.periodDurationSec}s) start=${new Date(d.startTimestamp * 1000).toISOString()}`,
    );
    console.log(
      `    processed=${processed} pending=${pending} skipped=${skipped} failed=${failed}`,
    );
  }
  console.log();

  const due = collectDuePeriods(state.distributions, now);
  console.log(`due-now: ${due.length}`);
  for (const p of due) {
    console.log(
      `  • ${p.distributionId.slice(0, 10)}…#${p.periodIndex}: window ${new Date(p.windowStart * 1000).toISOString()} → ${new Date(p.windowEnd * 1000).toISOString()}; budget ${formatEther(p.periodBudgetWei)} tokens`,
    );
  }
}
