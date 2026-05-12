/**
 * Inbox ingestion: pulls pending submissions from state/inbox.json, validates
 * them against hard caps + allowlist, materializes them into the state file
 * as full distributions, then clears the inbox.
 */
import { execSync } from "node:child_process";
import path from "node:path";
import { ulid } from "ulid";
import { parseUnits } from "ethers";
import type { InboxEntry, Distribution } from "../domain/distribution.js";
import { initialPeriodStates } from "../domain/periods.js";
import { loadInbox, clearInbox } from "../data/inbox.js";
import { loadState, saveState } from "../data/state.js";
import { getAllowedSubmitters } from "../core/config.js";
import {
  HARD_MAX_TOTAL_AMOUNT_TOKENS,
  HARD_MAX_NUM_PERIODS,
  HARD_MIN_PERIOD_DURATION_SEC,
  HARD_MAX_PERIOD_DURATION_SEC,
  HARD_MAX_FUTURE_START_SEC,
  HARD_MIN_PAST_START_SEC,
  HARD_MAX_ACTIVE_DISTRIBUTIONS,
  HARD_MAX_MONTHLY_BUDGET_TOKENS,
} from "../core/constants.js";
import { log } from "../core/logger.js";

interface ValidationContext {
  now: number;
  /** Distributions already active in state (used for aggregate caps). */
  activeCount: number;
  pendingBudgetTokens: bigint;
}

/**
 * Return the GitHub username of the most recent committer of `state/inbox.json`.
 *
 * GitHub's Contents API sets the committer to the PAT owner using a noreply
 * email of the form `<userId>+<username>@users.noreply.github.com`. We parse
 * the username out. Returns null when there's no git history (first run) or
 * when git is unavailable.
 *
 * The git query runs against the directory containing `inbox.json` (which may
 * be a separate checkout of the `state-data` branch, not the same repo where
 * the source code lives). We resolve the inbox file's containing directory
 * dynamically via STATE_DIR, then run `git log` from there.
 *
 * THIS IS THE AUTHORITATIVE SOURCE of "who submitted this inbox entry" — the
 * `submittedBy` field in the JSON is operator-supplied (via UI) and could be
 * lied about by a stolen PAT used by someone outside the allowlist.
 */
function lastInboxCommitter(): string | null {
  try {
    const stateDir = process.env.STATE_DIR
      ? path.resolve(process.env.STATE_DIR)
      : path.resolve(process.cwd(), "state");
    const email = execSync("git log -1 --pretty=format:%ce -- inbox.json", {
      cwd: stateDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!email) return null;
    // GitHub's Contents-API commits use:
    //   <userId>+<username>@users.noreply.github.com
    //   <username>@users.noreply.github.com (legacy)
    const githubMatch = email.match(/(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/i);
    if (githubMatch) return githubMatch[1];
    return null;
  } catch {
    return null;
  }
}

/**
 * Enforce the allowlist by checking the actual git committer of
 * `state/inbox.json`, not the operator-supplied `submittedBy` field. Returns
 * true if processing should proceed.
 */
function isInboxAllowlisted(allowedSubmitters: string[]): boolean {
  if (allowedSubmitters.length === 0) return true; // empty = accept all
  const committer = lastInboxCommitter();
  if (!committer) {
    // No git history yet, or the inbox is empty and was never committed.
    // Safe to process — there's nothing for an attacker to have written.
    return true;
  }
  const ok = allowedSubmitters.includes(committer);
  if (!ok) {
    log.warn("ingest: inbox committer not in allowlist", {
      committer,
      allowed: allowedSubmitters,
    });
  }
  return ok;
}

function validateEntry(entry: InboxEntry, ctx: ValidationContext): Distribution | null {
  const drop = (reason: string) => {
    log.warn("ingest: dropping inbox entry", { reason, entry });
    return null;
  };

  // Schema-ish validation
  let totalTokens: bigint;
  try {
    totalTokens = BigInt(entry.totalAmount);
  } catch {
    return drop("totalAmount is not a valid integer string");
  }
  if (totalTokens <= 0n) return drop("totalAmount must be > 0");
  if (totalTokens > HARD_MAX_TOTAL_AMOUNT_TOKENS) {
    return drop(`totalAmount ${totalTokens} > HARD_MAX_TOTAL_AMOUNT_TOKENS ${HARD_MAX_TOTAL_AMOUNT_TOKENS}`);
  }

  if (!Number.isInteger(entry.numPeriods) || entry.numPeriods <= 0) {
    return drop("numPeriods must be a positive integer");
  }
  if (entry.numPeriods > HARD_MAX_NUM_PERIODS) {
    return drop(`numPeriods ${entry.numPeriods} > HARD_MAX_NUM_PERIODS ${HARD_MAX_NUM_PERIODS}`);
  }

  if (
    !Number.isInteger(entry.periodDurationSec) ||
    entry.periodDurationSec < HARD_MIN_PERIOD_DURATION_SEC ||
    entry.periodDurationSec > HARD_MAX_PERIOD_DURATION_SEC
  ) {
    return drop(
      `periodDurationSec ${entry.periodDurationSec} outside [${HARD_MIN_PERIOD_DURATION_SEC}, ${HARD_MAX_PERIOD_DURATION_SEC}]`,
    );
  }

  let startTimestamp: number;
  if (entry.startTimestamp === "now") {
    startTimestamp = ctx.now;
  } else if (typeof entry.startTimestamp === "number" && Number.isFinite(entry.startTimestamp)) {
    startTimestamp = entry.startTimestamp;
  } else {
    return drop("startTimestamp must be 'now' or a unix-seconds number");
  }
  if (startTimestamp < ctx.now - HARD_MIN_PAST_START_SEC) {
    return drop(`startTimestamp ${startTimestamp} is more than ${HARD_MIN_PAST_START_SEC}s in the past`);
  }
  if (startTimestamp > ctx.now + HARD_MAX_FUTURE_START_SEC) {
    return drop(`startTimestamp ${startTimestamp} is too far in the future`);
  }

  // Aggregate caps
  if (ctx.activeCount + 1 > HARD_MAX_ACTIVE_DISTRIBUTIONS) {
    return drop(`would exceed HARD_MAX_ACTIVE_DISTRIBUTIONS=${HARD_MAX_ACTIVE_DISTRIBUTIONS}`);
  }
  if (ctx.pendingBudgetTokens + totalTokens > HARD_MAX_MONTHLY_BUDGET_TOKENS) {
    return drop(
      `aggregate budget ${ctx.pendingBudgetTokens + totalTokens} > HARD_MAX_MONTHLY_BUDGET_TOKENS ${HARD_MAX_MONTHLY_BUDGET_TOKENS}`,
    );
  }

  // Materialize
  const totalAmountWei = parseUnits(totalTokens.toString(), 18);
  if (totalAmountWei / BigInt(entry.numPeriods) === 0n) {
    return drop("perPeriod budget would round to zero");
  }
  const d: Distribution = {
    id: ulid(),
    createdAt: ctx.now,
    totalAmountWei: totalAmountWei.toString(),
    numPeriods: entry.numPeriods,
    periodDurationSec: entry.periodDurationSec,
    startTimestamp,
    periodStates: initialPeriodStates(entry.numPeriods),
    submittedBy: entry.submittedBy,
    notes: entry.notes,
  };
  // Update accumulator
  ctx.activeCount += 1;
  ctx.pendingBudgetTokens += totalTokens;
  return d;
}

/** Drain inbox into state. Returns count of accepted entries. */
export async function ingest(now: number = Math.floor(Date.now() / 1000)): Promise<number> {
  const [state, inbox] = await Promise.all([loadState(), loadInbox()]);
  if (inbox.pending.length === 0) return 0;

  const allowedSubmitters = getAllowedSubmitters();

  // Allowlist check via git committer — the AUTHORITATIVE source of who put
  // the inbox entries here. If the committer is not in the allowlist, drop
  // the whole inbox and clear it (next legitimate submission rebuilds it).
  if (!isInboxAllowlisted(allowedSubmitters)) {
    log.warn("ingest: aborting and clearing inbox (committer not allowlisted)", {
      droppedCount: inbox.pending.length,
    });
    await clearInbox();
    return 0;
  }

  const ctx: ValidationContext = {
    now,
    activeCount: state.distributions.length,
    pendingBudgetTokens: 0n,
  };

  let accepted = 0;
  for (const entry of inbox.pending) {
    const d = validateEntry(entry, ctx);
    if (d) {
      state.distributions.push(d);
      accepted += 1;
      log.info("ingest: accepted", {
        id: d.id,
        amountTokens: entry.totalAmount,
        numPeriods: d.numPeriods,
        periodDurationSec: d.periodDurationSec,
        startTimestamp: d.startTimestamp,
        submittedBy: d.submittedBy,
      });
    }
  }

  await saveState(state);
  await clearInbox();
  log.info("ingest: complete", { accepted, dropped: inbox.pending.length - accepted });
  return accepted;
}
