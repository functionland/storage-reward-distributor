# Operations Guide — storage-reward-distributor

End-to-end procedures for deploying, operating, and recovering this distributor.

---

## Table of contents

1. [One-time setup](#one-time-setup)
2. [Adding a distribution](#adding-a-distribution)
3. [Monitoring](#monitoring)
4. [Troubleshooting](#troubleshooting)
5. [Secret rotation](#secret-rotation)
6. [Recovery procedures](#recovery-procedures)
7. [Threat model summary](#threat-model-summary)

---

## One-time setup

### A. Create the operator wallet

The operator wallet signs `submitStorageRewardsBatch` transactions. Treat it like a low-privilege bot:

1. Generate a **fresh keypair**. Suggested: install [Foundry](https://book.getfoundry.sh/) and run `cast wallet new`. Or use any wallet that exposes the raw private key.
2. **Never reuse** a wallet that holds ADMIN_ROLE on RewardEngine, large token balances, or other privileged authority.
3. Save the private key in:
   - Your password manager (1Password, Bitwarden, etc.)
   - The GitHub Actions secret `OPERATOR_PRIVATE_KEY` (next step)
   - Nowhere else. Not in `.env` committed to git. Not in chat. Not pasted into the UI.

### B. Grant on-chain authority

The wallet needs `POOL_ADMIN_ROLE` on the RewardEngine on each chain. **Do NOT** grant `ADMIN_ROLE`.

From the main admin wallet, create a governance proposal:

1. On Base: `RewardEngine.createProposal(type=1 /* AddRole */, id=0, target=<distributorWallet>, role=keccak256("POOL_ADMIN_ROLE"), amount=0, tokenAddress=0x0)`. Get quorum. Wait 24h. Execute.
2. Same on SKALE.

Verify both: `RewardEngine.hasRole(POOL_ADMIN_ROLE, <distributorWallet>)` returns true on both chains.

### C. Fund the wallet

- **SKALE Europa Hub**: Gas is near-zero, but you need some sFUEL. Use the [SKALE faucet](https://sfuel.skale.network/) once.
- **Base**: ~$5 worth of ETH for ongoing gas. Refill monthly via a small transfer. Never park a large balance.

### D. Configure GitHub Actions secrets

Repo → Settings → Secrets and variables → Actions → New repository secret.

| Name | Value |
|---|---|
| `OPERATOR_PRIVATE_KEY` | The 0x-prefixed 64-hex private key |
| `BASE_RPC_URL` (optional) | Custom Base RPC if public is rate-limited |
| `SKALE_RPC_URL` (optional) | Custom SKALE RPC if needed |

And variables (Repo → Settings → Secrets and variables → Actions → Variables tab):

| Name | Value |
|---|---|
| `ALLOWED_SUBMITTERS` | Comma-separated GitHub usernames whose inbox entries the cron accepts. Empty = accept all. Example: `ehsan,coadmin` |
| `LOG_LEVEL` (optional) | `info` (default), `debug` for verbose |

### E. Create the `production` environment

Repo → Settings → Environments → New environment → name: `production`.

In the environment settings:
- **Deployment branches and tags** → "Selected branches and tags" → add `main`.
- (Required reviewers: leave OFF so cron can run unattended.)

This scopes the `OPERATOR_PRIVATE_KEY` secret so it's only exposed to workflow runs on `main`, not to any random branch a contributor might push.

### F. Enable GitHub Pages

Repo → Settings → Pages → Build and deployment → Source: **GitHub Actions**. Push to `main` and the `pages.yml` workflow will publish to `https://<owner>.github.io/<repo>/`.

### F2. State branch setup (REQUIRED, one-time)

State files (`state/distributions.json` and `state/inbox.json`) live on a separate **`state-data`** branch — NOT on `main`. This lets the cron commit state updates freely while `main` stays maximally strict (CodeQL, PR-required, signed commits, etc. — for human commits only).

Create the branch once:

```bash
cd <your-local-clone>
git checkout main
git pull
# Create an orphan branch with NO history from main
git checkout --orphan state-data
# Clear everything except the state/ directory
git rm -rf --cached . 2>/dev/null || true
find . -maxdepth 1 ! -name . ! -name .git ! -name state -exec rm -rf {} \;
# Add a tiny README so the branch isn't visually empty
echo "# state-data — managed by storage-reward-distributor" > README.md
echo "" >> README.md
echo "This branch contains the distributor's runtime state. The hourly cron commits here; do NOT edit manually except during incident recovery (see docs/OPERATIONS.md on main)." >> README.md
git add state/ README.md
git commit -m "init state-data branch"
git push -u origin state-data
# Return to main
git checkout main
```

**Make the state-data branch unprotected.** The repo's ruleset(s) typically apply only to `main` — verify under Settings → Rules. If you have an "all branches" ruleset, exclude `state-data` from it. The bot needs to push freely here.

The UI reads + writes state on `state-data` via the GitHub Contents API. The workflow checks out both branches into separate directories and points the tick command at the state-data checkout via the `STATE_DIR` env var.

### G. Branch protection on `main`

Repo → Settings → Branches → Add rule → `main`:
- ✅ Require pull request before merging (1 approval)
- ✅ Require status checks to pass before merging
- ✅ Do not allow bypassing the above settings
- ✅ Restrict who can push to matching branches (allow only the bot + admins)
- ✅ Require linear history (optional but cleaner)

These prevent an attacker who somehow got write access to a branch from sneaking a malicious change into the workflow.

### G2. Verify the SHA-pinned third-party actions

Before the first push, open `.github/workflows/distribute.yml` and `pages.yml` and for each pinned action SHA, verify it maps to the documented release:

```bash
# Example: confirm actions/checkout SHA b4ffde65… is v4.1.1
curl -s https://api.github.com/repos/actions/checkout/git/refs/tags/v4.1.1 \
  | jq -r .object.sha
# should print: b4ffde65f46336ab88eb53be808477a3936bae11
```

Repeat for: `actions/setup-node`, `actions/configure-pages`, `actions/upload-pages-artifact`, `actions/deploy-pages`, `actions/github-script`. If any SHA differs, do not push until the discrepancy is investigated.

When you next bump a workflow's action version, re-verify the new SHA the same way.

### H. First successful tick

1. Verify `.github/workflows/distribute.yml` is on `main`.
2. Actions → Distribute storage rewards → **Run workflow** → branch=main → Run.
3. Watch the logs. Should report "no due periods" (no distributions yet) and complete.
4. If it errors, see [Troubleshooting](#troubleshooting).

### I. Verify the UI

1. Open `https://<owner>.github.io/<repo>/`.
2. Issue a fine-grained PAT for yourself (next section explains how).
3. Authenticate; you should see "Authenticated as <your-login>".
4. The Status panel should show "No distributions yet."

---

## Adding a distribution

### Issue a fine-grained Personal Access Token

GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token.

| Setting | Value |
|---|---|
| Token name | `storage-reward-distributor-<date>` |
| Resource owner | Your account or the org that owns the repo |
| Repository access | "Only select repositories" → pick `storage-reward-distributor` |
| Repository permissions → Contents | Read and write |
| Repository permissions → all other | No access |
| Expiration | 7 days (re-issue weekly) |

Copy the token (starts with `github_pat_`). It's shown only once.

### Submit the distribution

1. Open the UI.
2. Paste the PAT, click "Save & verify". Should display your login.
3. Fill in:
   - **Total amount** (tokens, e.g., `1000`)
   - **Number of periods** (e.g., `4`)
   - **Period duration** (default 12h)
   - **Start** (`now` or an ISO timestamp)
4. Click **Submit**. The entry goes into `state/inbox.json` via a single API write. Commit message in your repo shows you as the author.

### What happens next

- The next hourly cron tick (≤ 1h) calls `ingest`, validates the entry against [hard caps](#defense-in-depth-caps), and either materializes it into `state/distributions.json` or silently drops it (with a log message).
- Once materialized, periods start "becoming due" 12h after `startTimestamp`. At each tick, all backlogged due periods are processed.

### Defense-in-depth caps

The cron re-validates everything the UI accepts; entries that violate ANY of these are silently dropped (so a stolen PAT can't probe error messages):

| Limit | Value | Configurable in |
|---|---|---|
| Max total per distribution | 100,000 tokens | `src/core/constants.ts` |
| Max periods | 60 | same |
| Period duration | 1h to 24h | same |
| Future start | ≤ 30 days | same |
| Past start | ≤ 1h ago | same |
| Max active distributions | 10 | same |
| Aggregate budget per month | 1,000,000 tokens | same |
| Allowlisted submitters | env `ALLOWED_SUBMITTERS` | repo variables |

To raise these, edit `src/core/constants.ts`, open a PR, get a review, merge to `main`. Branch protection ensures this can't be unilateral.

---

## Monitoring

### Daily

- Open the UI Status panel. Confirm "Last tick" is within the past hour.
- Check that pending distributions are progressing (processed count rising).
- Skim the most-recent Actions runs (Actions → Distribute storage rewards) for warnings.

### On failure

If a tick fails twice in a row, the workflow opens a GitHub Issue with the `distributor-failure` label. Subscribe to issue notifications.

### On-chain spot checks

For any processed period the UI shows `txByChain` hashes. Click through to the explorer to confirm:
- Base: <https://basescan.org/tx/...>
- SKALE: <https://elated-tan-skat.explorer.mainnet.skalenodes.com/tx/...>

The tx should contain a `StorageRewardsSubmitted` event with the expected `count` and `amount`.

---

## Troubleshooting

### "OPERATOR_PRIVATE_KEY is not set"
The workflow can't read the secret. Verify:
1. Secret exists at the repo level (Settings → Secrets → Actions).
2. The workflow run is on the `production` environment AND the branch matches the environment's deployment-branch rule. If you ran from a feature branch, the environment will refuse to expose the secret.

### "fetchOnlinePeers: queryFilter error"
Public RPC rate limit. Set `BASE_RPC_URL` or `SKALE_RPC_URL` to a private endpoint (Alchemy, Infura, ChainStack).

### Tick succeeded but no transactions appear on-chain
Either:
- No peers were online during the period (Status panel shows `onlineCount: 0`).
- All eligible peers hit the monthly cap (Status panel shows `skipReason`).
- Dry-run mode is on (`DRY_RUN=true` in the workflow env). Set to `false`.

### "MonthlyCapExceeded" warnings every tick
You're trying to credit more than 8000 tokens per peer per month. Either:
- Reduce the total amount of new distributions.
- Wait until next calendar month resets the cap.
- Drop the heaviest peers from the active set (let them recover before next month).

### Push race on state commit
Sometimes two workflow runs land on the same minute. The commit step retries up to 3 times with `git pull --rebase`. If all 3 fail, the workflow exits with an error and opens an issue. Manually re-run; the catch-up logic ensures no period is skipped.

### PAT was leaked
Immediately:
1. Revoke the PAT (GitHub → Settings → Developer settings → Personal access tokens → … → Delete).
2. Check `state/inbox.json` and the recent commit history for any rogue entries.
3. If any were ingested into distributions, manually delete them from `state/distributions.json` BEFORE the next cron tick. Commit and push (the cron has `concurrency: distribute` so it won't overlap).
4. Issue a new PAT with a shorter expiration.

---

## Secret rotation

Rotate the operator wallet's private key **every 90 days** or immediately on any suspicion of compromise.

1. **Generate new wallet** (same procedure as initial setup).
2. **Grant role to new wallet**: from main admin wallet, propose `RewardEngine.createProposal(type=1 /* AddRole */, id=0, target=<newWallet>, role=keccak256("POOL_ADMIN_ROLE"), amount=0, tokenAddress=0x0)` on BOTH Base AND SKALE. Get quorum. Wait 24h. Execute.
3. **Update GitHub secret** `OPERATOR_PRIVATE_KEY` to the new key.
4. **Run a manual tick** (Actions → workflow_dispatch) to verify the new key works.
5. **Revoke role from old wallet**: propose `createProposal(type=2 /* RemoveRole */, …)` for the old wallet on both chains. Get quorum. Wait 24h. Execute.
6. **Drain old wallet**: send residual ETH/sFUEL back to your treasury.
7. **Document the rotation** in `docs/ROTATION_LOG.md` (date, new wallet address, reason).

If the old wallet was actively compromised (not just suspected), do step 5 FIRST — accepting the cron downtime while the timelock runs — then step 2 in parallel.

---

## Recovery procedures

### Retried period and a member left between attempts

If a period failed partway through (some chunks succeeded, then chunk N failed), the next tick **resumes from chunk N using the cached peer list** captured on the original attempt. That list is locked in `state/distributions.json` under `chunkProgress.<chain>.peers`. If a member left the pool between the first attempt and the retry, the retry will still credit their peerId — but the credit lands in `unclaimedStoragePerPeer[poolId][peerId]` and becomes a stranded balance the ex-member can't claim. This is a correct consequence of the design (peerId-keyed storage; see `contracts/UPGRADING.md` in fula-chain). Either accept the stranded balance, or manually edit `state/distributions.json` to remove the ex-member from the cached peers list before the retry runs — at the cost of slightly less than the originally-intended per-peer reward (the budget is fixed at submission time and isn't redistributed when peers are dropped mid-flight).

### Distribution submitted incorrectly
If a distribution was ingested with wrong parameters and hasn't started yet:

1. Edit `state/distributions.json` directly to fix or remove the offending entry.
2. Open a PR (branch protection requires it).
3. Get review, merge to `main`.
4. The next cron tick picks up the corrected state.

If periods have ALREADY been processed, you can't undo on-chain credits. Compensate via a negative-amount distribution (credit subtracted = `isCredit: false` debit, but the current UI only supports credits; you'd run a one-off script from local). Open an issue and discuss before doing this.

### Cron disabled / runner down
GitHub Actions can be disabled per-repo, per-org, or globally (rare). Catch-up is built in: when the cron resumes, the next tick processes ALL backlogged periods in order.

### Migrate to own server (fallback)
If GitHub Actions becomes unreliable, you can run `npm run tick` from a Linux server's cron:
1. Clone the repo to `/opt/storage-reward-distributor/`.
2. `npm ci && npm run build`.
3. Create `/etc/cron.d/storage-reward-distributor`:
   ```
   0 * * * * www-data cd /opt/storage-reward-distributor && OPERATOR_PRIVATE_KEY=... npm run tick >> /var/log/srd.log 2>&1
   ```
4. The state file becomes the local copy; you'd need to sync with the repo manually or via a separate cron.
5. Disable the GitHub Actions cron to avoid double-processing.

---

## Threat model summary

| Threat | Mitigation |
|---|---|
| Public repo code visible | Acceptable — no secret in code |
| Workflow log leakage | Secrets redacted by GitHub Actions + custom logger redaction |
| PR from fork accessing secrets | Workflow uses only `schedule` and `workflow_dispatch` — fork PRs get no secrets |
| Compromised contributor / PR with malicious workflow change | Branch protection requires review |
| Stolen PAT | sessionStorage (not persistent), short expiration, allowlist-checked submitters, hard caps as last line |
| Compromised operator wallet | Dedicated wallet, only POOL_ADMIN_ROLE, monthly cap (8000/peer), 90-day rotation |
| RPC injection / man-in-the-middle | HTTPS RPC endpoints; use private endpoints in env if possible |
| State file tampering on main | Branch protection requires PR + review |

For additional context see the plan at `C:\Users\ehsan\.claude\plans\keep-the-renamed-in-staged-wave.md`.
