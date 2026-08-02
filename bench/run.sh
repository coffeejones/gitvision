#!/usr/bin/env bash
# Analyse both corpora with the CURRENT working tree, then score.
# This is the loop: change a rule -> bench/run.sh -> read the two tables.
set -euo pipefail
BENCH="${BENCH:-$HOME/.codetrawl-bench}"
[ -d "$BENCH/realvuln" ] || { echo "no corpora — run bench/bootstrap.sh"; exit 1; }
OUT="$BENCH/realvuln/scan-results"

for c in rvrepos heldout; do
  [ -d "$BENCH/$c" ] || continue
  echo "→ analysing $c"
  npx tsx bench/emit.ts "$BENCH/$c" "$OUT" >/dev/null
done
BENCH="$BENCH" python3 bench/score.py "$@"

echo
echo "→ production false-positive gate (must stay quiet)"
npx tsx bench/prod.ts "$BENCH"/pyprobe/zulip "$BENCH"/pyprobe/netbox "$BENCH"/pyprobe/saleor | tail -3
