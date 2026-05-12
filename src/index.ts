/**
 * CLI dispatcher.
 *
 * Usage:
 *   tsx src/index.ts tick
 *   tsx src/index.ts ingest
 *   tsx src/index.ts status
 *
 * In production this is called from the GitHub Actions workflow via npm scripts.
 */
import { tick } from "./commands/tick.js";
import { ingest } from "./commands/ingest.js";
import { status } from "./commands/status.js";
import { log } from "./core/logger.js";

/**
 * In GitHub Actions, refuse to run unless we're on `refs/heads/main`. The
 * production environment's "Deployment branches → main only" rule scopes
 * secrets to runs on main, but this is a config the operator manually sets
 * and can forget. A workflow accidentally enabled on a feature branch would
 * have no secrets and just no-op safely — but a workflow on `main` with the
 * environment misconfigured (deploy-branches set to "any") would expose the
 * key to any branch. Belt-and-suspenders.
 */
function assertProductionGuard(): void {
  if (process.env.GITHUB_ACTIONS !== "true") return; // local dev: skip
  const ref = process.env.GITHUB_REF;
  if (ref && ref !== "refs/heads/main") {
    throw new Error(
      `Refusing to run on ref '${ref}'. Production secrets should be scoped to refs/heads/main via the GitHub Environment "production" deployment-branch rule.`,
    );
  }
}

// Catch unhandled rejections / uncaught exceptions BEFORE the logger gets a
// chance to read them. Use process.exit(1) so the workflow fails loudly.
process.on("uncaughtException", (err) => {
  log.error("uncaughtException", { msg: (err as Error)?.message });
  process.exit(1);
});
process.on("unhandledRejection", (err) => {
  log.error("unhandledRejection", { msg: (err as Error)?.message });
  process.exit(1);
});

async function main(): Promise<void> {
  assertProductionGuard();
  const cmd = process.argv[2];
  switch (cmd) {
    case "tick":
      await tick();
      return;
    case "ingest":
      await ingest();
      return;
    case "status":
      await status();
      return;
    default:
      console.error("Usage: tsx src/index.ts <tick|ingest|status>");
      process.exit(1);
  }
}

main().catch((err) => {
  log.error("FATAL", {
    msg: (err as Error)?.message,
    stack: (err as Error)?.stack,
  });
  process.exit(1);
});
