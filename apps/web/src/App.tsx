import { useEffect, useState } from "react";
import {
  clearPat,
  fetchFile,
  fetchRaw,
  getPat,
  getRepoCoords,
  putFile,
  setPat,
  whoami,
} from "./github";

interface InboxEntry {
  submittedAt: number;
  submittedBy?: string;
  totalAmount: string;
  numPeriods: number;
  periodDurationSec: number;
  startTimestamp: number | "now";
  notes?: string;
}

interface PeriodState {
  periodIndex: number;
  status: string;
  txByChain?: Record<string, string[]>;
  onlineCount?: { skale: number; base: number; uniqueAfterDedupe: number };
  perPeerWei?: string;
  skipReason?: string;
  failureReason?: string;
  processedAt?: number;
}

interface Distribution {
  id: string;
  createdAt: number;
  totalAmountWei: string;
  numPeriods: number;
  periodDurationSec: number;
  startTimestamp: number;
  periodStates: PeriodState[];
  submittedBy?: string;
  notes?: string;
}

interface State {
  schemaVersion: 1;
  lastTick?: { ts: number };
  distributions: Distribution[];
}

interface Inbox {
  pending: InboxEntry[];
}

export function App() {
  const repo = getRepoCoords();
  return (
    <>
      <h1>Storage Reward Distributor</h1>
      <p className="muted">
        Repo: <code>{repo.owner}/{repo.repo}</code> · pool 1 on Base + SKALE
      </p>
      <AuthPanel />
      <AddDistribution />
      <StatusView />
      <p className="muted" style={{ marginTop: 32 }}>
        Distributor source:{" "}
        <a
          href={`https://github.com/${repo.owner}/${repo.repo}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {repo.owner}/{repo.repo}
        </a>
        . Workflow runs are visible under the Actions tab. Local state lives in{" "}
        <code>state/distributions.json</code>.
      </p>
    </>
  );
}

function AuthPanel() {
  const [pat, setPatState] = useState<string>(() => getPat() ?? "");
  const [user, setUser] = useState<string>("");
  const [err, setErr] = useState<string>("");

  async function save() {
    setPat(pat.trim());
    setErr("");
    try {
      const login = await whoami();
      setUser(login);
    } catch (e) {
      setUser("");
      setErr((e as Error).message);
    }
  }
  function logout() {
    clearPat();
    setPatState("");
    setUser("");
    setErr("");
  }

  useEffect(() => {
    if (pat && !user) save();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="panel">
      <h2>1. Authenticate</h2>
      <p className="muted">
        Paste a <strong>fine-grained Personal Access Token</strong> with{" "}
        <code>Contents: Read and write</code> on this repo only, expiration ≤ 7 days. Token is
        stored in <code>sessionStorage</code>; it is wiped when this tab closes.
      </p>
      <label>
        <span>Personal Access Token</span>
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={pat}
          onChange={(e) => setPatState(e.target.value)}
          placeholder="github_pat_…"
        />
      </label>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button onClick={save} disabled={!pat.trim()}>
          Save & verify
        </button>
        <button onClick={logout} style={{ background: "#2a3041", color: "var(--text)" }}>
          Clear
        </button>
      </div>
      {user && (
        <p className="ok" style={{ marginTop: 12 }}>
          Authenticated as <code>{user}</code>
        </p>
      )}
      {err && (
        <p className="error" style={{ marginTop: 12 }}>
          {err}
        </p>
      )}
    </div>
  );
}

function AddDistribution() {
  const [amount, setAmount] = useState("1000");
  const [periods, setPeriods] = useState("4");
  const [duration, setDuration] = useState("43200"); // 12h
  const [start, setStart] = useState("now");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function submit() {
    setBusy(true);
    setMsg(null);
    try {
      const totalAmount = String(Number(amount));
      const numPeriods = Number(periods);
      const periodDurationSec = Number(duration);
      const startTimestamp: number | "now" =
        start === "now" ? "now" : Math.floor(new Date(start).getTime() / 1000);

      if (!Number.isFinite(numPeriods) || numPeriods <= 0) throw new Error("Invalid periods");
      if (!Number.isFinite(periodDurationSec) || periodDurationSec <= 0)
        throw new Error("Invalid duration");
      if (Number(totalAmount) <= 0) throw new Error("Amount must be > 0");

      const me = await whoami();

      const { content, sha } = await fetchFile<Inbox>("state/inbox.json");
      const entry: InboxEntry = {
        submittedAt: Math.floor(Date.now() / 1000),
        submittedBy: me,
        totalAmount,
        numPeriods,
        periodDurationSec,
        startTimestamp,
        notes: notes.trim() || undefined,
      };
      const next: Inbox = { pending: [...(content.pending ?? []), entry] };
      await putFile(
        "state/inbox.json",
        next,
        sha,
        `inbox: add ${totalAmount} tokens × ${numPeriods} periods by ${me}`,
      );
      setMsg({ kind: "ok", text: "Submitted. The next cron tick will ingest it." });
      setAmount("1000");
      setPeriods("4");
      setNotes("");
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h2>2. Add a distribution</h2>
      <p className="muted">
        The budget is split equally across periods, then equally across all online pool members
        (deduplicated across chains — SKALE preferred). Per-peer monthly cap: 8000 tokens.
      </p>
      <div className="row">
        <label>
          <span>Total amount (tokens)</span>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min="1" />
        </label>
        <label>
          <span>Number of periods</span>
          <input
            value={periods}
            onChange={(e) => setPeriods(e.target.value)}
            type="number"
            min="1"
            max="60"
          />
        </label>
      </div>
      <div className="row">
        <label>
          <span>Period duration</span>
          <select value={duration} onChange={(e) => setDuration(e.target.value)}>
            <option value="43200">12 hours</option>
            <option value="57600">16 hours</option>
            <option value="86400">24 hours</option>
            <option value="3600">1 hour (testing)</option>
          </select>
        </label>
        <label>
          <span>Start</span>
          <input
            value={start}
            onChange={(e) => setStart(e.target.value)}
            placeholder="now or 2026-05-13T12:00:00Z"
          />
        </label>
      </div>
      <label>
        <span>Notes (optional)</span>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button onClick={submit} disabled={busy || !getPat()}>
          {busy ? "Submitting…" : "Submit"}
        </button>
        {!getPat() && <span className="muted">(authenticate first)</span>}
      </div>
      {msg && <p className={msg.kind === "ok" ? "ok" : "error"}>{msg.text}</p>}
    </div>
  );
}

function StatusView() {
  const [state, setState] = useState<State | null>(null);
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [err, setErr] = useState<string>("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const [s, i] = await Promise.all([
        fetchRaw("state/distributions.json").then((t) => JSON.parse(t) as State),
        fetchRaw("state/inbox.json").then((t) => JSON.parse(t) as Inbox),
      ]);
      setState(s);
      setInbox(i);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="panel">
      <h2>3. Status</h2>
      {loading && <p className="muted">Loading…</p>}
      {err && <p className="error">{err}</p>}
      {state && (
        <>
          <p className="muted">
            Last tick:{" "}
            {state.lastTick ? new Date(state.lastTick.ts * 1000).toLocaleString() : "never"}{" "}
            · pending inbox: {inbox?.pending.length ?? 0}
          </p>
          <h3>Distributions ({state.distributions.length})</h3>
          {state.distributions.length === 0 && <p className="muted">None yet.</p>}
          {state.distributions.map((d) => {
            const processed = d.periodStates.filter((p) => p.status === "processed").length;
            const pending = d.periodStates.filter((p) => p.status === "pending").length;
            const failed = d.periodStates.filter((p) => p.status === "failed").length;
            return (
              <div key={d.id} style={{ marginBottom: 12 }}>
                <p>
                  <code>{d.id.slice(0, 12)}…</code> · {fmtTokens(d.totalAmountWei)} tokens ÷{" "}
                  {d.numPeriods} periods of {(d.periodDurationSec / 3600).toFixed(0)}h · start{" "}
                  {new Date(d.startTimestamp * 1000).toLocaleString()}
                  {d.submittedBy && (
                    <>
                      {" "}
                      · by <code>{d.submittedBy}</code>
                    </>
                  )}
                </p>
                <p className="muted">
                  ✓ {processed} · ⏳ {pending}
                  {failed > 0 && <span className="error"> · ✗ {failed}</span>}
                </p>
                {d.notes && <p className="muted">📝 {d.notes}</p>}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

function fmtTokens(wei: string): string {
  try {
    const n = BigInt(wei);
    const whole = n / 10n ** 18n;
    const frac = n % 10n ** 18n;
    if (frac === 0n) return whole.toString();
    const fracStr = (frac + 10n ** 18n).toString().slice(1).replace(/0+$/, "");
    return `${whole}.${fracStr}`;
  } catch {
    return wei;
  }
}
