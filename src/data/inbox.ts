/**
 * Load / save the inbox file. Inbox is populated by the UI (via GitHub
 * Contents API) and drained at the start of each tick.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Inbox } from "../domain/distribution.js";

/**
 * Inbox lives alongside the state file. Same STATE_DIR override applies.
 * See `state.ts` for the override rationale.
 */
const STATE_DIR = process.env.STATE_DIR
  ? path.resolve(process.env.STATE_DIR)
  : path.resolve(process.cwd(), "state");
const INBOX_PATH = path.join(STATE_DIR, "inbox.json");

const EMPTY: Inbox = { pending: [] };

export async function loadInbox(): Promise<Inbox> {
  try {
    const raw = await fs.readFile(INBOX_PATH, "utf8");
    const parsed = JSON.parse(raw) as Inbox;
    if (!Array.isArray(parsed.pending)) {
      throw new Error("Malformed inbox: pending is not an array");
    }
    return parsed;
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e?.code === "ENOENT") return { ...EMPTY };
    throw err;
  }
}

export async function saveInbox(inbox: Inbox): Promise<void> {
  await fs.mkdir(STATE_DIR, { recursive: true });
  const tmp = `${INBOX_PATH}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(inbox, null, 2) + "\n", "utf8");
  await fs.rename(tmp, INBOX_PATH);
}

export async function clearInbox(): Promise<void> {
  await saveInbox({ ...EMPTY });
}
