/**
 * Load / save the distributions state file.
 *
 * State lives at `state/distributions.json` in the repo, committed back at
 * the end of each tick by the workflow.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { State } from "../domain/distribution.js";

const STATE_DIR = path.resolve(process.cwd(), "state");
const STATE_PATH = path.join(STATE_DIR, "distributions.json");

const EMPTY_STATE: State = {
  schemaVersion: 1,
  distributions: [],
};

export async function loadState(): Promise<State> {
  try {
    const raw = await fs.readFile(STATE_PATH, "utf8");
    const parsed = JSON.parse(raw) as State;
    if (parsed.schemaVersion !== 1) {
      throw new Error(`Unsupported state schemaVersion: ${parsed.schemaVersion}`);
    }
    if (!Array.isArray(parsed.distributions)) {
      throw new Error("Malformed state: distributions is not an array");
    }
    return parsed;
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e?.code === "ENOENT") {
      return { ...EMPTY_STATE };
    }
    throw err;
  }
}

export async function saveState(state: State): Promise<void> {
  await fs.mkdir(STATE_DIR, { recursive: true });
  const tmp = `${STATE_PATH}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2) + "\n", "utf8");
  await fs.rename(tmp, STATE_PATH);
}
