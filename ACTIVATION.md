# Activation runbook — turning the built pieces on

The Gate, Merge Receipts, the Watch cron, and the AI explainer are **built and
deployed**. They degrade gracefully while their secret/permission is missing (the
Gate still comments, Watch just doesn't fire, receipts skip the signature). This
is the config to switch them fully on — none of it is code.

**Verify as you go:** run `npm run metrics` (or `npm run metrics:cli`) and watch
the **Activation** panel. Each switch flips from `✗ not set` to `✓ wired` once the
env var lands on the deployed box. (`checks:write` is the one exception — it's a
GitHub-side permission, not an env var, so verify it with a real PR.)

---

## 1. Merge Receipt signing — `RECEIPT_SECRET`

**Enables:** the Gate issues an HMAC-signed, permalinked Merge Receipt
(`/r/<id>`), trustlessly verifiable at `POST /api/receipts/verify`. Without it the
Gate still posts its check + comment — just no signed certificate.

- **Generate:** `openssl rand -hex 32`
- **Set:** Railway → the web service → Variables → `RECEIPT_SECRET=<value>` → redeploy.
- **Verify:** `npm run metrics` → Activation → **Receipt signing ✓**. End-to-end:
  merge a PR the Gate reviewed and open the receipt link; it should carry a seal
  that `/api/receipts/verify` reports authentic.

## 2. Watch cron — `CRON_SECRET`

**Enables:** the scheduled re-sweep of watched repos + regression email alerts.
The endpoint (`/api/cron/watch-monitor`) and the GitHub Actions workflow
(`.github/workflows/watch-monitor.yml`) already exist; they just need the shared
secret on both ends.

- **Generate:** `openssl rand -hex 32`
- **Set (two places, same value):**
  - Railway → Variables → `CRON_SECRET=<value>` → redeploy.
  - GitHub → repo → Settings → Secrets and variables → Actions → new secret
    `CRON_SECRET=<value>` (the workflow reads it to authenticate the call).
- **Verify:** `npm run metrics` → Activation → **Watch cron auth ✓** confirms the
  Railway side. That it actually *fires* shows as **Watch last ran: <time>** once
  the workflow runs (trigger it manually from the Actions tab to check now, or
  wait for the schedule). Long-null past a day = the workflow isn't reaching the
  endpoint (check the Actions secret + the workflow's URL).

## 3. PR Gate check runs — `checks:write` (GitHub App permission)

**Enables:** the "CodeTrawl Gate" **Check Run** on PRs (clear / review / high-risk),
which a repo can make blocking via branch protection. Without it the Gate still
posts its verdict as a comment; only the check is skipped (403 → skipped, not an
error).

- **Set:** GitHub → the CodeTrawl **App** settings → Permissions → Repository
  permissions → **Checks: Read & write** → save → accept the permission upgrade on
  each installation when prompted.
- **Verify:** open a PR on an installed repo — the **CodeTrawl Gate** check should
  appear in the PR's checks. (Not introspectable from the metrics tap — it's a
  GitHub-side grant. The Activation panel's **GitHub App ✓** only confirms the app
  is configured, i.e. `GITHUB_APP_ID` + `GITHUB_APP_PRIVATE_KEY` are set.)

## 4. (Bonus) AI explainer — `ANTHROPIC_API_KEY`

Already tracked here for completeness: set on Railway → **AI explainer ✓**. Powers
the per-function "read with AI" in the Source view.

---

## Not config — a separate build: the `codetrawl-mcp` npm package

"MCP hosting" (so agents `npx codetrawl-mcp` instead of cloning from source) is a
real bundling project, not a switch: the MCP server imports deeply from the app's
`lib/` (blast radius, shadow-graph, signals, github) and needs its tree-sitter
WASM assets bundled. That's its own arc — see `mcp/README.md` (status:
pre-npm-publish) and `SHADOW_GRAPH_PLAN.md`. Until then, agents install from
source per `mcp/README.md`.
