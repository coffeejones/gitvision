#!/usr/bin/env bash
#
# bake-demos.sh — re-bake the AI layer (briefing, health, verdict, recommendation)
# for all three public demo sessions in one shot.
#
# Run this AFTER re-sweeping the demos: refreshing a demo produces a fresh
# snapshot, but the AI layer is deliberately NOT auto-generated for demos (so
# logged-out visitors never trigger live model calls). This bakes it so the
# briefing/health/verdict show up again instead of an empty AI panel.
#
# It just POSTs to /api/admin/bake-demo-ai for each demo id (endpoint is scoped
# to demo ids only, and inert until ADMIN_SECRET is set on the server).
#
# Usage:
#   ADMIN_SECRET=xxxxx ./scripts/bake-demos.sh
#   ADMIN_SECRET=xxxxx BASE_URL=http://localhost:3000 ./scripts/bake-demos.sh   # local test
#
# Requires: bash + curl. No other dependencies.

set -euo pipefail

BASE_URL="${BASE_URL:-https://codetrawl.com}"

# Demo session ids — keep in sync with lib/demoSessions.ts (DEMO_SESSIONS).
# "label|sessionId"
DEMOS=(
  "zod|qRUWdkTNh-"
  "flask|2W8VJwPfzl"
  "gin|zHpVZ1Ybto"
)

if [[ -z "${ADMIN_SECRET:-}" ]]; then
  echo "✗ ADMIN_SECRET is not set." >&2
  echo "  Run:  ADMIN_SECRET=<the secret from Railway env> ./scripts/bake-demos.sh" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "✗ curl is required but not found." >&2
  exit 1
fi

echo "Baking demo AI against ${BASE_URL}"
echo

failures=0
for entry in "${DEMOS[@]}"; do
  label="${entry%%|*}"
  sid="${entry##*|}"
  printf '→ %-6s (%s) … ' "$label" "$sid"

  # -s silent, -S show errors, -w append the HTTP status on its own last line.
  response="$(
    curl -sS -X POST "${BASE_URL}/api/admin/bake-demo-ai" \
      -H "Authorization: Bearer ${ADMIN_SECRET}" \
      -H "Content-Type: application/json" \
      -d "{\"sessionId\":\"${sid}\"}" \
      -w $'\n%{http_code}' 2>&1
  )" || true

  status="$(printf '%s' "$response" | tail -n1)"
  body="$(printf '%s' "$response" | sed '$d')"

  if [[ "$status" == "200" ]]; then
    # Pull the "baked" list out for a friendly one-liner (best-effort, no jq).
    baked="$(printf '%s' "$body" | grep -o '"baked":\[[^]]*\]' || true)"
    echo "✓ 200  ${baked:-ok}"
  else
    echo "✗ ${status:-error}"
    printf '   %s\n' "$body"
    failures=$((failures + 1))
  fi
done

echo
if [[ "$failures" -eq 0 ]]; then
  echo "All three demos baked. ✓"
else
  echo "${failures} demo(s) failed. ✗  (401/404 = bad/absent ADMIN_SECRET; 501 = ANTHROPIC_API_KEY unset on server)"
  exit 1
fi
