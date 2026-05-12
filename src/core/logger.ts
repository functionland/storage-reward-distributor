/**
 * Structured JSON logger with secret-redaction.
 *
 * Logs are emitted line-per-event as JSON so they're easy to search in GitHub
 * Actions log viewer. Sensitive substrings (matching the configured private
 * key) are masked before printing.
 *
 * GitHub Actions also auto-redacts exact matches of stored secrets, but this
 * provides defense-in-depth (e.g., if a log message accidentally includes a
 * derivation of the key, or for local-dev terminal output).
 */

type Level = "error" | "warn" | "info" | "debug";

const LEVEL_RANK: Record<Level, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

function configuredLevel(): Level {
  const raw = (process.env.LOG_LEVEL || "info").toLowerCase() as Level;
  return raw in LEVEL_RANK ? raw : "info";
}

/**
 * Patterns that should be redacted from any log output.
 *
 * Only the EXACT configured private key is redacted — we deliberately do NOT
 * include a catch-all `\b[0-9a-f]{64}\b` regex because that would mask legit
 * bytes32 peerIds in audit logs (every `submitStorageRewardsBatch` log
 * includes peerIds). The exact-match redaction is sufficient: GitHub Actions
 * also auto-redacts the secret on its own (defense in depth).
 */
function buildRedactionPatterns(): RegExp[] {
  const patterns: RegExp[] = [];

  const pk = process.env.OPERATOR_PRIVATE_KEY?.trim();
  if (pk && pk.length > 0) {
    // Match with or without 0x prefix
    const stripped = pk.startsWith("0x") ? pk.slice(2) : pk;
    if (stripped.length >= 16) {
      patterns.push(new RegExp(stripped, "gi"));
    }
  }

  return patterns;
}

function redact(input: string, patterns: RegExp[]): string {
  let out = input;
  for (const p of patterns) {
    out = out.replace(p, "***REDACTED***");
  }
  return out;
}

function safeStringify(obj: unknown): string {
  return JSON.stringify(obj, (_key, value) => {
    if (typeof value === "bigint") return value.toString() + "n";
    return value;
  });
}

function emit(level: Level, msg: string, extra?: Record<string, unknown>): void {
  if (LEVEL_RANK[level] > LEVEL_RANK[configuredLevel()]) return;

  const patterns = buildRedactionPatterns();
  const record = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(extra ?? {}),
  };
  const line = redact(safeStringify(record), patterns);
  if (level === "error") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}

export const log = {
  error: (msg: string, extra?: Record<string, unknown>) => emit("error", msg, extra),
  warn: (msg: string, extra?: Record<string, unknown>) => emit("warn", msg, extra),
  info: (msg: string, extra?: Record<string, unknown>) => emit("info", msg, extra),
  debug: (msg: string, extra?: Record<string, unknown>) => emit("debug", msg, extra),
};
