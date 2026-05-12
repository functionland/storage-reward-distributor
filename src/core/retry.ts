/**
 * Exponential-backoff retry wrapper.
 *
 * Usage:
 *   const result = await withRetry(() => provider.getBlock("latest"), "getBlock");
 */
import { RETRY_DELAYS_MS } from "./constants.js";
import { log } from "./logger.js";

export interface RetryOptions {
  delaysMs?: readonly number[];
  /** Predicate: returns true if the error should be retried. Defaults to retrying everything. */
  retryable?: (err: unknown) => boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  opts: RetryOptions = {},
): Promise<T> {
  const delays = opts.delaysMs ?? RETRY_DELAYS_MS;
  const retryable = opts.retryable ?? (() => true);

  let lastErr: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === delays.length || !retryable(err)) break;
      const delay = delays[attempt];
      log.warn("retry", {
        label,
        attempt: attempt + 1,
        of: delays.length,
        delayMs: delay,
        errMsg: (err as Error)?.message,
      });
      await sleep(delay);
    }
  }
  throw lastErr;
}
