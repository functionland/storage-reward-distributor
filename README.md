# storage-reward-distributor

Automated orchestrator that distributes storage rewards on the [fula-chain](https://github.com/) RewardEngine contracts (deployed on Base and SKALE). Pool operator defines a budget (e.g., "1000 tokens over 4 periods of 12 hours each"); this tool fetches the peerIds that were online on each chain during each period, filters them to actual pool members, deduplicates across chains, and credits each peer's storage-reward balance via `submitStorageRewardsBatch`.

## High-level architecture

```
┌──────────────────────────────────┐
│  GitHub Pages (static UI)        │
│  • add-distribution form         │ ─── PAT-authed write ──┐
│  • status dashboard              │                        │
└──────────────────────────────────┘                        ▼
                                                ┌───────────────────────────┐
┌──────────────────────────────────┐            │  Repo state files in main │
│  GitHub Actions cron (hourly)    │ ◀──── git pull ─────── distributions.json│
│  1. ingest inbox → state         │                        inbox.json       │
│  2. find due periods             │                        ▲                │
│  3. fetch online peers (×2)      │       git push state ──┘                │
│  4. filter to pool members       │            └───────────────────────────┘
│  5. dedupe cross-chain           │
│  6. submitStorageRewardsBatch    │ ─── tx ──▶ Base RewardEngine
│  7. commit updated state         │ ─── tx ──▶ SKALE RewardEngine
└──────────────────────────────────┘
```

## Quick start

1. **Fork or clone this repo** to your own GitHub account.
2. **Configure secrets** in repo Settings → Secrets and variables → Actions:
   - `OPERATOR_PRIVATE_KEY` — dedicated wallet with `POOL_ADMIN_ROLE` on both RewardEngines.
3. **Configure variables** (optional) in the same place:
   - `BASE_RPC_URL`, `SKALE_RPC_URL` — custom RPCs if hitting public rate limits.
4. **Enable GitHub Pages** in Settings → Pages → Source: "GitHub Actions".
5. **Set up branch protection** on `main`: require PR + 1 review for changes to `.github/workflows/**` and `src/**`.
6. **Push** to trigger the first Pages deployment. The UI will be at `https://<your-user>.github.io/storage-reward-distributor/`.
7. **Verify the cron is running**: Actions → "Distribute storage rewards" → look for hourly successful runs.

See [`docs/OPERATIONS.md`](docs/OPERATIONS.md) for full operator procedures including wallet setup, secret rotation, troubleshooting.

## Local development

```bash
# Install (uses npm workspaces — installs root + apps/web deps in one shot)
npm install

# Copy env template and fill
cp .env.example .env

# Run a dry-run tick (no transactions sent)
npm run dry-run

# Unit tests
npm test

# Web UI dev server
npm run web:dev
```

## Security

This repo is public, so secrets must be handled carefully:

- The `OPERATOR_PRIVATE_KEY` lives ONLY in:
  - GitHub Actions secrets (encrypted at rest, redacted from logs)
  - Your password manager
- The wallet should be **dedicated** to this distributor — fund it minimally, grant only `POOL_ADMIN_ROLE`, no `ADMIN_ROLE`.
- The maximum extractable value if the key is leaked is bounded by the per-peer monthly cap (`DEFAULT_MONTHLY_REWARD_PER_PEER = 8000 tokens`) × N members. Rotate immediately on any suspicion.

Detailed threat model and mitigations in `docs/OPERATIONS.md`.

## Status

Production-ready hourly cron + UI for `poolId = 1` on both Base and SKALE.

## License

MIT (or pick whichever your team uses).
